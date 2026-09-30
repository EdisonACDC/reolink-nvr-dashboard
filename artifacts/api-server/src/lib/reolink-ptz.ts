/** Reolink HTTP PTZ: paths/commands follow reolink_aio's public implementation.
 * Each tap is a bounded movement; Stop and Logout run even after request failure.
 */
import { createHash } from "node:crypto";
export interface PtzTarget { host: string; port: number; username: string; password: string; channel: number }
export interface PtzCapabilities { pan: boolean; tilt: boolean; speed: boolean; telephoto: boolean; zoom: { min: number; max: number; position: number } | null }
export class PtzError extends Error {
  status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}
const directions = new Set(["Left", "Right", "Up", "Down", "LeftUp", "LeftDown", "RightUp", "RightDown"]);
export function createPtzController(request: typeof fetch = fetch, pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
  type Active = { target: PtzTarget; token?: string; stopped: boolean; moving: boolean };
  const active = new Map<string, Active>();
  const cache = new Map<string, { at: number; value: PtzCapabilities }>();
  const key = (t: PtzTarget) => createHash("sha256").update(JSON.stringify(t)).digest("hex");
  const deviceKey = (t: PtzTarget) => `${t.host}:${t.port}`;
  async function call(t: PtzTarget, cmd: string, param: unknown, token?: string, action = 0): Promise<any> {
    const host = t.host.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
    const endpoint = `${t.port === 443 ? "https" : "http"}://${host}:${t.port}/cgi-bin/api.cgi?cmd=${cmd}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
    let response: Response;
    try {
      response = await request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ cmd, action, param }]), signal: AbortSignal.timeout(cmd === "Login" ? 5000 : 2500) });
    } catch { throw new PtzError("Il NVR non risponde al comando. Controlla il collegamento e riprova."); }
    if (!response.ok) throw new PtzError(`Comando ${cmd}: il NVR risponde HTTP ${response.status}.`);
    let data: any;
    try { data = (await response.json() as any[])[0]; } catch { throw new PtzError("Risposta del NVR non valida."); }
    if (data?.code !== 0 || (data.value?.rspCode !== undefined && data.value.rspCode !== 200)) {
      const code = Number(data?.error?.rspCode ?? data?.value?.rspCode);
      throw new PtzError(code === -29 ? "NVR occupato: troppe sessioni. Attendi qualche secondo." : `Il NVR non ha accettato ${cmd}${Number.isFinite(code) ? ` (codice ${code})` : ""}. Verifica supporto e permessi dell’utente.`);
    }
    return data;
  }
  async function stop(state: Active): Promise<void> {
    state.stopped = true;
    if (!state.token) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await call(state.target, "PtzCtrl", { channel: state.target.channel, op: "Stop" }, state.token); return; }
      catch { /* retry Stop before closing the session */ }
    }
    throw new PtzError("STOP non confermato dal NVR. Premi STOP e verifica la telecamera.");
  }
  async function session<T>(t: PtzTarget, work: (state: Active) => Promise<T>): Promise<T> {
    if (!Number.isInteger(t.channel) || t.channel < 0 || !t.host || !t.username) throw new PtzError("NVR o canale non configurato.", 400);
    const id = deviceKey(t);
    if (active.has(id)) throw new PtzError("Un comando è già in corso. Attendi che termini.", 409);
    const state: Active = { target: t, stopped: false, moving: false };
    active.set(id, state);
    try {
      const login = await call(t, "Login", { User: { userName: t.username, password: t.password } });
      const token = login.value?.Token?.name;
      if (typeof token !== "string" || !token) throw new PtzError("Accesso al controllo telecamera non riuscito.");
      state.token = token;
      return await work(state);
    } finally {
      try { if (state.moving) await stop(state); }
      finally {
        if (state.token) { try { await call(t, "Logout", {}, state.token); } catch { /* No credentials/tokens exposed. */ } }
        if (active.get(id) === state) active.delete(id);
      }
    }
  }
  async function readZoom(t: PtzTarget, token: string) {
    const data = await call(t, "GetZoomFocus", { channel: t.channel }, token, 1);
    const position = data.value?.ZoomFocus?.zoom?.pos;
    const range = data.range?.ZoomFocus?.zoom?.pos;
    if (![position, range?.min, range?.max].every(Number.isInteger) || range.max <= range.min) return null;
    return { min: range.min as number, max: range.max as number, position: position as number };
  }
  async function readCapabilities(t: PtzTarget, state: Active): Promise<PtzCapabilities> {
    const existing = cache.get(key(t));
    if (existing && Date.now() - existing.at < 60_000) return existing.value;
    const ability = await call(t, "GetAbility", { User: { userName: t.username } }, state.token);
    const ch = ability.value?.Ability?.abilityChn?.[t.channel];
    if (!ch) throw new PtzError("Il NVR non espone i comandi di questo canale.", 422);
    const type = Number(ch.ptzType?.ver || 0);
    let zoom = null;
    if ([1,2,5].includes(type) || Number(ch.supportDigitalZoom?.ver) > 0) {
      try { zoom = await readZoom(t, state.token!); } catch { /* unsupported zoom is hidden */ }
    }
    const value = { pan: [2,3,5,6,7].includes(type), tilt: [2,3,5,6].includes(type),
      speed: Number(ch.supportPtzSpeed?.ver ?? 1) > 0, telephoto: Number(ch.supportAutoTrackStream?.ver) > 0, zoom };
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(key(t), { at: Date.now(), value });
    return value;
  }
  return {
    capabilities: (t: PtzTarget) => session(t, state => readCapabilities(t, state)),
    async command(t: PtzTarget, action: string, speed = 8): Promise<void> {
      if (!Number.isInteger(t.channel) || t.channel < 0 || !t.host || !t.username) throw new PtzError("NVR o canale non configurato.", 400);
      if (![...directions, "Stop", "ZoomIn", "ZoomOut"].includes(action)) throw new PtzError("Comando non valido.", 400);
      if (!Number.isInteger(speed) || speed < 1 || speed > 32) throw new PtzError("Velocità non valida.", 400);
      if (action === "Stop") {
        const running = active.get(deviceKey(t));
        if (running && running.target.channel === t.channel) { await stop(running); return; }
        // A Stop on a second channel must not be rejected by the movement lock.
        const login = await call(t, "Login", { User: { userName: t.username, password: t.password } });
        const token = login.value?.Token?.name;
        if (typeof token !== "string" || !token) throw new PtzError("Accesso al controllo telecamera non riuscito.");
        try { await call(t, "PtzCtrl", { channel: t.channel, op: "Stop" }, token); }
        finally { try { await call(t, "Logout", {}, token); } catch {} }
        return;
      }
      await session(t, async state => {
        const caps = await readCapabilities(t, state);
        if (state.stopped) return;
        if (action === "ZoomIn" || action === "ZoomOut") {
          if (!caps.zoom) throw new PtzError("Zoom non disponibile su questa telecamera.", 422);
          const zoom = await readZoom(t, state.token!);
          if (!zoom) throw new PtzError("Limiti dello zoom non disponibili.", 422);
          const step = Math.max(1, Math.round((zoom.max - zoom.min) / 10));
          const pos = Math.max(zoom.min, Math.min(zoom.max, zoom.position + (action === "ZoomIn" ? step : -step)));
          if (state.stopped) return;
          await call(t, "StartZoomFocus", { ZoomFocus: { channel: t.channel, op: "ZoomPos", pos } }, state.token);
          cache.delete(key(t));
          // Allow the device to reach the target before the next relative tap.
          await pause(3000);
          return;
        }
        if ((/Left|Right/.test(action) && !caps.pan) || (/Up|Down/.test(action) && !caps.tilt)) throw new PtzError("Movimento non supportato da questa telecamera.", 422);
        // Mark before sending: an ambiguous timeout must still trigger Stop.
        state.moving = true;
        await call(t, "PtzCtrl", { channel: t.channel, op: action, ...(caps.speed ? { speed } : {}) }, state.token);
        if (!state.stopped) await pause(350);
      });
    },
  };
}
export const reolinkPtz = createPtzController();
