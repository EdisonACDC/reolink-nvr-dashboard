import { createHash } from "node:crypto";

export interface ReolinkChannel {
  channel: number; // Reolink API is zero-based; UI/RTSP channel numbers are one-based.
  name: string;
  online: boolean;
  mainPath?: string;
  subPath?: string;
}
export interface ReolinkLoginResult {
  online: boolean;
  reason: string;
  channels?: ReolinkChannel[];
  rtspPort?: number;
}

/** A connectivity probe owns its token only until Logout completes. */
export function createReolinkLogin(
  request: typeof fetch = fetch,
  now: () => number = Date.now,
  discoverChannels = false,
) {
  // Serialize probes, including a config save racing with a manual sync/poll.
  // Keep one short-lived result; never retain passwords or tokens in the cache.
  let tail: Promise<unknown> = Promise.resolve();
  let cached: { key: string; until: number; result: ReolinkLoginResult } | undefined;

  return (host: string, port: number, username: string, password: string): Promise<ReolinkLoginResult> => {
    const key = createHash("sha256").update(JSON.stringify([host, port, username, password])).digest("hex");
    const run = tail.then(async () => {
      if (cached?.key === key && now() < cached.until) return cached.result;
      const result = await probe(host, port, username, password);
      const delay = result.online && result.reason === "Connesso al NVR" ? 10_000 : 60_000;
      cached = { key, until: now() + delay, result };
      return result;
    });
    tail = run.catch(() => {});
    return run;
  };

  async function probe(host: string, port: number, username: string, password: string): Promise<ReolinkLoginResult> {
    if (!host) return { online: false, reason: "NVR non configurato (host mancante)" };
    const scheme = port === 443 ? "https" : "http";
    const base = `${scheme}://${host}:${port}/cgi-bin/api.cgi`;
    let token: string | undefined;
    let logoutFailed = false;
    let result: ReolinkLoginResult;
    try {
      const response = await request(`${base}?cmd=Login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ cmd: "Login", action: 0, param: { User: { userName: username, password } } }]),
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) return { online: false, reason: `Il NVR ha risposto con HTTP ${response.status} sulla porta ${port}. Verifica la porta API/HTTP.` };
      let data: any;
      try { data = await response.json(); }
      catch { return { online: false, reason: `Risposta non valida dal NVR sulla porta ${port} (non JSON).` }; }
      const entry = Array.isArray(data) ? data[0] : undefined;
      const name = entry?.value?.Token?.name;
      if (entry?.code === 0 && typeof name === "string" && name.length > 0) {
        token = name;
        result = { online: true, reason: "Connesso al NVR" };
        if (discoverChannels) {
          // Discovery is optional: unsupported commands must not break login.
          try {
            const call = async (commands: unknown[]) => {
              const response = await request(`${base}?token=${encodeURIComponent(token!)}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(commands), signal: AbortSignal.timeout(7000),
              });
              return response.ok ? await response.json() as any[] : [];
            };
            const data = await call([{ cmd: "GetChannelstatus", action: 0, param: {} }, { cmd: "GetNetPort", action: 0, param: {} }]);
            const statuses = data.find(entry => entry.cmd === "GetChannelstatus" && entry.code === 0)?.value?.status;
            const port = Number(data.find(entry => entry.cmd === "GetNetPort" && entry.code === 0)?.value?.NetPort?.rtspPort);
            if (Number.isInteger(port) && port > 0 && port <= 65535) result.rtspPort = port;
            if (Array.isArray(statuses)) {
              result.channels = statuses.filter(item => Number.isInteger(item.channel) && item.channel >= 0 && item.channel < 128)
                .map(item => ({ channel: item.channel, name: String(item.name || ""), online: item.online === 1 || item.online === true }));
              const connected = result.channels.filter(channel => channel.online);
              if (connected.length) {
                const urls = await call(connected.map(channel => ({ cmd: "GetRtspUrl", action: 0, param: { channel: channel.channel } })));
                for (const entry of urls) {
                  const rtsp = entry?.code === 0 ? entry.value?.rtspUrl : undefined;
                  const channel = result.channels.find(channel => channel.channel === rtsp?.channel);
                  if (!channel) continue;
                  const safePath = (raw: unknown): string | undefined => {
                    if (typeof raw !== "string") return undefined;
                    try {
                      const url = new URL(raw);
                      // Keep only a path, never device-supplied credentials/host/token.
                      return /^rtsps?:$/.test(url.protocol) && !url.search && url.pathname.startsWith("/") ? url.pathname : undefined;
                    } catch { return undefined; }
                  };
                  channel.mainPath = safePath(rtsp.mainStream);
                  channel.subPath = safePath(rtsp.subStream);
                }
              }
            }
          } catch { /* Preserve connectivity result and standard RTSP fallbacks. */ }
        }
      } else {
        const detail = String(entry?.error?.detail || entry?.error?.rspCode || "risposta di login non valida");
        if (/max.*session|session.*(?:max|limit)|maximum.*users/i.test(detail) || Number(entry?.error?.rspCode) === -29) {
          result = {
            online: false,
            reason: "NVR raggiungibile, ma limite delle sessioni raggiunto (max session). Questo errore non indica una password errata. Chiudi gli altri collegamenti al NVR e attendi la scadenza delle sessioni precedenti. L'add-on riproverà automaticamente, al massimo una volta al minuto.",
          };
        } else {
          result = { online: false, reason: `Login non riuscito: ${detail}. Verifica l'utente LOCALE e la password del NVR; l'account Reolink Cloud è distinto.` };
        }
      }
    } catch (error: any) {
      const code = error?.cause?.code || error?.code || error?.name || "";
      const reason = code === "TimeoutError" || /timeout|aborted/i.test(error?.message || "")
        ? `Timeout: nessuna risposta da ${host}:${port} entro 7s. Verifica il collegamento tra l'add-on Home Assistant e il NVR; il telefono può essere fuori rete.`
        : code === "ECONNREFUSED"
          ? `Connessione rifiutata su ${host}:${port}. Verifica la porta API e il servizio HTTP del NVR.`
          : `Errore di collegamento dall'add-on al NVR ${host}:${port} (${code || "errore di rete"}).`;
      result = { online: false, reason };
    } finally {
      if (token) {
        try {
          const response = await request(`${base}?cmd=Logout&token=${encodeURIComponent(token)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([{ cmd: "Logout", action: 0, param: {} }]),
            signal: AbortSignal.timeout(5000),
          });
          if (!response.ok) logoutFailed = true;
          else {
            const data = await response.json() as any;
            logoutFailed = !Array.isArray(data) || data[0]?.code !== 0;
          }
        } catch { logoutFailed = true; }
      }
    }
    if (result.online && logoutFailed) {
      result.reason = "Connesso al NVR, ma la chiusura della sessione di prova non è stata confermata. Prossima verifica tra almeno un minuto.";
    }
    return result;
  }
}

export const reolinkLogin = createReolinkLogin(fetch, Date.now, true);

