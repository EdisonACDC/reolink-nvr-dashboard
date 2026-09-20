import { Router, type IRouter } from "express";
import { spawn } from "node:child_process";
import { jsonStore } from "../store/json-store";
import { logger } from "../lib/logger";
import { cameraRtspUrl, publicRtspUrl } from "../lib/camera-source";
import {
  getStorageStatus,
  listRecordedFiles,
  listStorageLocations,
  recorderCameraError,
  recordingFilePath,
  updateStorageConfig,
} from "../lib/nvr-recorder";
import {
  getReolinkStreamFile,
  waitForStreamFile,
} from "../lib/reolink-stream";
import {
  GetNvrConfigResponse,
  UpdateNvrConfigBody,
  UpdateNvrConfigResponse,
  GetCamerasResponse,
  CreateCameraBody,
  UpdateCameraParams,
  UpdateCameraBody,
  UpdateCameraResponse,
  DeleteCameraParams,
  GetCameraSnapshotParams,
  GetCameraSnapshotResponse,
  GetNvrStatusResponse,
  GetRecordingsQueryParams,
  GetRecordingsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

interface CameraSourceFields {
  sourceType?: "standalone" | "reolink_nvr";
  rtspUrl?: string;
  subStreamUrl?: string;
  username?: string;
  password?: string;
  recordingMode?: "continuous" | "motion" | "off";
  retentionDays?: number | null;
}

function cameraSourceFields(body: unknown): CameraSourceFields {
  if (!body || typeof body !== "object") return {};
  const value = body as Record<string, unknown>;
  const sourceType = value.sourceType === "reolink_nvr"
    ? "reolink_nvr"
    : value.sourceType === "standalone" ? "standalone" : undefined;
  const mode = value.recordingMode;
  const recordingMode = mode === "motion" || mode === "off" || mode === "continuous"
    ? mode
    : undefined;
  const retentionDays = value.retentionDays === null
    ? null
    : value.retentionDays === undefined
      ? undefined
      : Math.min(3650, Math.max(1, Number(value.retentionDays) || 7));
  return {
    sourceType,
    rtspUrl: typeof value.rtspUrl === "string" ? value.rtspUrl.trim() : undefined,
    subStreamUrl: typeof value.subStreamUrl === "string" ? value.subStreamUrl.trim() : undefined,
    username: typeof value.username === "string" ? value.username : undefined,
    password: typeof value.password === "string" ? value.password : undefined,
    recordingMode,
    retentionDays,
  };
}

function cameraResponse(camera: ReturnType<typeof jsonStore.getCameraById>) {
  if (!camera) return null;
  return {
    id: camera.id,
    channel: camera.channel,
    name: camera.name,
    status: (camera.status || "unknown") as "online" | "offline" | "unknown",
    recordingEnabled: camera.recordingEnabled,
    motionDetection: camera.motionDetection,
    resolution: camera.resolution ?? undefined,
    nvrId: camera.nvrId,
    streamUrl: buildStreamUrl(camera.id),
    snapshotUrl: buildSnapshotProxyUrl(camera.id),
    sourceType: camera.sourceType || "reolink_nvr",
    rtspUrl: publicRtspUrl(camera.rtspUrl),
    subStreamUrl: publicRtspUrl(camera.subStreamUrl),
    username: camera.username || "",
    recordingMode: camera.recordingMode || (camera.recordingEnabled ? "continuous" : "off"),
    retentionDays: camera.retentionDays ?? null,
    lastError: recorderCameraError(camera.id),
  };
}

// ---------------------------------------------------------------------------
// Reolink NVR HTTP API helpers
// ---------------------------------------------------------------------------

export interface ReolinkLoginResult {
  online: boolean;
  /** Human-readable (Italian) reason describing the outcome — always set. */
  reason: string;
}

/**
 * Try to authenticate with the Reolink NVR HTTP API.
 * Returns a diagnostic result: whether the NVR responded with a valid login
 * token, plus a human-readable reason so failures are observable in the log
 * and in the UI (network unreachable vs. wrong credentials).
 */
async function reolinkLogin(
  host: string,
  port: number,
  username: string,
  password: string,
): Promise<ReolinkLoginResult> {
  if (!host) return { online: false, reason: "NVR non configurato (host mancante)" };
  // Reolink devices expose their HTTP API at /cgi-bin/api.cgi. When the API
  // port is 443 we must use HTTPS (self-signed cert — reject unauthorized off).
  const scheme = port === 443 ? "https" : "http";
  const url = `${scheme}://${host}:${port}/cgi-bin/api.cgi?cmd=Login`;
  const body = JSON.stringify([
    { cmd: "Login", action: 0, param: { User: { userName: username, password } } },
  ]);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(7000),
    });
    if (!resp.ok) {
      const reason = `Il NVR ha risposto con HTTP ${resp.status} sulla porta ${port}. Verifica la porta API/HTTP.`;
      logger.warn({ host, port, status: resp.status }, "reolinkLogin: HTTP non OK");
      return { online: false, reason };
    }
    let data: any[];
    try {
      data = (await resp.json()) as any[];
    } catch {
      const reason = `Risposta non valida dal NVR sulla porta ${port} (non è un dispositivo Reolink API?).`;
      logger.warn({ host, port }, "reolinkLogin: risposta non JSON");
      return { online: false, reason };
    }
    const entry = Array.isArray(data) ? data[0] : undefined;
    if (entry?.code === 0 && entry?.value?.Token) {
      logger.info({ host, port, username }, "reolinkLogin: autenticazione riuscita");
      return { online: true, reason: "Connesso al NVR" };
    }
    // Reolink returns an error object with a detail string when login fails
    const detail: string = entry?.error?.detail || entry?.error?.rspCode || "credenziali rifiutate";
    const reason = `Login rifiutato dal NVR: ${detail}. Usa l'utente LOCALE del NVR (es. "admin"), non l'email dell'account Reolink Cloud.`;
    logger.warn({ host, port, username, detail }, "reolinkLogin: login rifiutato");
    return { online: false, reason };
  } catch (err: any) {
    const code = err?.cause?.code || err?.code || err?.name || "";
    const isTimeout = code === "TimeoutError" || /timeout|aborted/i.test(err?.message || "");
    let reason: string;
    if (isTimeout) {
      logger.warn({ host, port, code }, "reolinkLogin: timeout");
      return {
        online: false,
        reason: `Timeout: nessuna risposta da ${host}:${port} entro 7s. Il NVR non è raggiungibile dalla rete dell'add-on (verifica IP/porta e che l'add-on possa raggiungere la LAN).`,
      };
    }
    switch (code) {
      case "ECONNREFUSED":
        reason = `Connessione rifiutata su ${host}:${port}. Porta chiusa o servizio non attivo su quella porta.`;
        break;
      case "EHOSTUNREACH":
      case "ENETUNREACH":
        reason = `Host non raggiungibile (${host}). L'add-on non riesce a raggiungere la rete locale del NVR.`;
        break;
      case "ENOTFOUND":
        reason = `Indirizzo non trovato (${host}). Verifica l'IP del NVR.`;
        break;
      default:
        reason = `Errore di rete verso ${host}:${port}: ${err?.message || code || "sconosciuto"}.`;
    }
    logger.warn({ host, port, code, msg: err?.message }, "reolinkLogin: errore di rete");
    return { online: false, reason };
  }
}

/**
 * Ensure cameras for each NVR channel exist in the store and set their status.
 * Creates missing cameras and updates existing ones.
 */
function autoSyncCameras(
  config: { id: number; channelCount: number; nvrId?: number },
  online: boolean,
): void {
  const existing = jsonStore.getCameras(config.id);
  const count = Math.max(1, config.channelCount || 4);
  const status = online ? "online" : "offline";
  for (let ch = 1; ch <= count; ch++) {
    const cam = existing.find((c) => c.channel === ch);
    if (!cam) {
      jsonStore.createCamera({
        nvrId: config.id,
        channel: ch,
        name: `Camera CH${ch}`,
        status,
        recordingEnabled: true,
        motionDetection: true,
        resolution: null,
      });
    } else {
      jsonStore.updateCamera(cam.id, { status });
    }
  }
}

/**
 * Background polling — re-checks NVR connectivity every 30 s and updates camera statuses.
 */
setInterval(async () => {
  try {
    const config = jsonStore.getNvrConfig();
    if (!config || !config.host || !config.configured) return;
    const { online } = await reolinkLogin(config.host, config.port, config.username, config.password);
    autoSyncCameras(config, online);
  } catch {
    // ignore
  }
}, 30_000);

function getOrCreateNvrConfig() {
  const existing = jsonStore.getNvrConfig();
  if (existing) return existing;
  return jsonStore.createNvrConfig({
    name: "My NVR",
    host: "",
    port: 80,
    username: "admin",
    password: "",
    rtspPort: 554,
    httpPort: 80,
    channelCount: 4,
    configured: false,
    status: "unknown" as any,
  } as any);
}

function buildSnapshotProxyUrl(cameraId: number): string {
  return `./api/nvr/cameras/${cameraId}/snapshot/image`;
}

function buildStreamUrl(cameraId: number): string {
  return `./api/stream/camera/${cameraId}/index.m3u8`;
}

function cleanHost(host: string): string {
  return host.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function validateChannel(value: string, channelCount: number): number | null {
  const channel = Number.parseInt(value, 10);
  if (!Number.isInteger(channel) || channel < 1 || channel > channelCount) return null;
  return channel;
}

async function captureRtspSnapshot(sourceUrl: string): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-rtsp_transport", "tcp", "-rw_timeout", "8000000",
      "-i", sourceUrl,
      "-frames:v", "1", "-f", "image2", "-vcodec", "mjpeg", "pipe:1",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let errorText = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 10_000);
    child.stdout!.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      errorText = `${errorText}${chunk}`.replace(/rtsp:\/\/[^@\s]+@/gi, "rtsp://***@").slice(-1000);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      const image = Buffer.concat(chunks);
      if (code === 0 && image.length > 0) resolve(image);
      else reject(new Error(errorText || `ffmpeg terminato con codice ${code}`));
    });
  });
}

router.get("/nvr/config", (req, res): void => {
  const config = getOrCreateNvrConfig();
  res.json(GetNvrConfigResponse.parse({
    id: config.id,
    host: config.host,
    port: config.port,
    username: config.username,
    rtspPort: config.rtspPort,
    httpPort: config.httpPort,
    channelCount: config.channelCount,
    name: config.name,
    configured: config.configured,
  }));
});

router.put("/nvr/config", (req, res): void => {
  const parsed = UpdateNvrConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = getOrCreateNvrConfig();
  const updated = jsonStore.updateNvrConfig(existing.id, {
    name: parsed.data.name ?? existing.name,
    host: parsed.data.host,
    port: parsed.data.port ?? existing.port,
    username: parsed.data.username,
    password: parsed.data.password ?? existing.password,
    rtspPort: parsed.data.rtspPort ?? existing.rtspPort,
    httpPort: parsed.data.httpPort ?? existing.httpPort,
    channelCount: parsed.data.channelCount ?? existing.channelCount,
    configured: true,
  })!;
  res.json(UpdateNvrConfigResponse.parse({
    id: updated.id,
    host: updated.host,
    port: updated.port,
    username: updated.username,
    rtspPort: updated.rtspPort,
    httpPort: updated.httpPort,
    channelCount: updated.channelCount,
    name: updated.name,
    configured: updated.configured,
  }));

  // Non-blocking: attempt Reolink login and auto-create/update camera records
  const pwd = parsed.data.password ?? existing.password ?? "";
  reolinkLogin(updated.host, updated.port, updated.username, pwd)
    .then(({ online }) => autoSyncCameras(updated, online))
    .catch(() => {});
});

// ---------- Reset NVR config (clear credentials) ----------
router.delete("/nvr/config", (req, res): void => {
  const existing = jsonStore.getNvrConfig();
  if (existing) {
    // Delete all cameras first
    const cameras = jsonStore.getCameras(existing.id);
    for (const cam of cameras) {
      jsonStore.deleteCamera(cam.id);
    }
    // Reset config to defaults
    jsonStore.updateNvrConfig(existing.id, {
      name: "My NVR",
      host: "",
      port: 80,
      username: "admin",
      password: "",
      rtspPort: 554,
      httpPort: 80,
      channelCount: 4,
      configured: false,
    });
    logger.info("NVR config reset to defaults");
  }
  res.json({ ok: true });
});

router.get("/nvr/cameras", (req, res): void => {
  const config = getOrCreateNvrConfig();
  const cameras = jsonStore.getCameras(config.id);
  res.json(cameras.map((camera) => cameraResponse(camera)));
});

router.post("/nvr/cameras", (req, res): void => {
  const parsed = CreateCameraBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const source = cameraSourceFields(req.body);
  if ((source.sourceType ?? "standalone") === "standalone" && !source.rtspUrl) {
    res.status(400).json({ error: "Inserisci il flusso RTSP principale" });
    return;
  }
  const config = getOrCreateNvrConfig();
  const camera = jsonStore.createCamera({
    nvrId: config.id,
    channel: parsed.data.channel,
    name: parsed.data.name,
    status: "unknown",
    recordingEnabled: parsed.data.recordingEnabled ?? true,
    motionDetection: parsed.data.motionDetection ?? true,
    resolution: null,
    sourceType: source.sourceType ?? "standalone",
    rtspUrl: source.rtspUrl ?? "",
    subStreamUrl: source.subStreamUrl ?? "",
    username: source.username ?? "",
    password: source.password ?? "",
    recordingMode: source.recordingMode ?? "continuous",
    retentionDays: source.retentionDays ?? null,
  });
  res.status(201).json(cameraResponse(camera));
});

router.put("/nvr/cameras/:id", (req, res): void => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateCameraParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateCameraBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const source = cameraSourceFields(req.body);
  const config = getOrCreateNvrConfig();
  const camera = jsonStore.updateCamera(params.data.id, {
    channel: parsed.data.channel,
    name: parsed.data.name,
    recordingEnabled: parsed.data.recordingEnabled,
    motionDetection: parsed.data.motionDetection,
    sourceType: source.sourceType,
    rtspUrl: source.rtspUrl,
    subStreamUrl: source.subStreamUrl,
    username: source.username,
    password: source.password || undefined,
    recordingMode: source.recordingMode,
    retentionDays: source.retentionDays,
  });
  if (!camera) { res.status(404).json({ error: "Camera not found" }); return; }
  res.json(cameraResponse(camera));
});

router.delete("/nvr/cameras/:id", (req, res): void => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteCameraParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const deleted = jsonStore.deleteCamera(params.data.id);
  if (!deleted) { res.status(404).json({ error: "Camera not found" }); return; }
  res.sendStatus(204);
});

router.get("/nvr/cameras/:id/snapshot", (req, res): void => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetCameraSnapshotParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const camera = jsonStore.getCameraById(params.data.id);
  if (!camera) { res.status(404).json({ error: "Camera not found" }); return; }
  res.json(GetCameraSnapshotResponse.parse({
    cameraId: camera.id,
    url: buildSnapshotProxyUrl(camera.id),
    timestamp: new Date().toISOString(),
  }));
});

// Proxy dello snapshot: le credenziali del NVR restano nel backend e non
// vengono mai inviate al browser.
router.get("/nvr/cameras/:id/snapshot/image", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const cameraId = Number.parseInt(rawId, 10);
  const camera = jsonStore.getCameraById(cameraId);
  const config = getOrCreateNvrConfig();
  if (!camera) { res.status(404).json({ error: "Camera not found" }); return; }

  if (camera.sourceType === "standalone" || camera.rtspUrl) {
    const sourceUrl = cameraRtspUrl(camera, config, "sub");
    if (!sourceUrl) { res.status(503).json({ error: "Flusso RTSP non configurato" }); return; }
    try {
      const image = await captureRtspSnapshot(sourceUrl);
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "no-store");
      res.send(image);
    } catch (error: any) {
      logger.warn({ cameraId, error: error?.message }, "Snapshot RTSP non disponibile");
      res.status(502).json({ error: "Snapshot RTSP non disponibile" });
    }
    return;
  }

  if (!config.host || !config.username) {
    res.status(503).json({ error: "NVR non configurato" });
    return;
  }

  const scheme = config.httpPort === 443 ? "https" : "http";
  const params = new URLSearchParams({
    cmd: "Snap",
    channel: String(Math.max(0, camera.channel - 1)),
    rs: String(Date.now()),
    user: config.username,
    password: config.password,
  });
  const url = `${scheme}://${cleanHost(config.host)}:${config.httpPort}/cgi-bin/api.cgi?${params}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      res.status(502).json({ error: `Snapshot NVR: HTTP ${response.status}` });
      return;
    }
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const image = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    res.send(image);
  } catch (error: any) {
    logger.warn({ cameraId, error: error?.message }, "Snapshot Reolink non disponibile");
    res.status(502).json({ error: "Snapshot Reolink non disponibile" });
  }
});

// RTSP non è riproducibile dai browser. ffmpeg mantiene il codec video del
// sub-stream e lo impacchetta in HLS, evitando una transcodifica pesante.
router.get("/stream/camera/:channel/:filename", async (req, res): Promise<void> => {
  const config = getOrCreateNvrConfig();
  const rawChannel = Array.isArray(req.params.channel) ? req.params.channel[0] : req.params.channel;
  const rawFilename = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;
  const cameraId = Number.parseInt(rawChannel, 10);
  const camera = jsonStore.getCameraById(cameraId);
  const filename = rawFilename || "";

  if (!camera || !/^(index\.m3u8|segment-\d{6}\.ts)$/.test(filename)) {
    res.status(400).json({ error: "Canale o file HLS non valido" });
    return;
  }
  const sourceUrl = cameraRtspUrl(camera, config, "sub");
  if (!sourceUrl) {
    res.status(503).json({ error: "Configura il flusso RTSP della telecamera" });
    return;
  }

  const { filePath, state } = getReolinkStreamFile({
    sourceUrl,
  }, camera.id, filename);

  const available = filename === "index.m3u8"
    ? await waitForStreamFile(filePath)
    : await waitForStreamFile(filePath, 3_000);

  if (!available) {
    res.status(503).json({
      error: "Stream non disponibile. Verifica RTSP, credenziali e codec H.264 del sub-stream.",
      detail: state.lastError.slice(-500),
    });
    return;
  }

  res.setHeader(
    "Content-Type",
    filename.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t",
  );
  res.setHeader("Cache-Control", filename.endsWith(".m3u8") ? "no-store" : "public, max-age=30");
  res.sendFile(filePath);
});

router.get("/nvr/status", (req, res): void => {
  const config = getOrCreateNvrConfig();
  const cameras = jsonStore.getCameras(config.id);
  const online = cameras.filter((c) => c.status === "online").length;
  const storage = getStorageStatus();
  res.json(GetNvrStatusResponse.parse({
    connected: cameras.length > 0 && online > 0,
    diskUsage: storage.recordingsBytes / (1024 ** 3),
    diskTotal: storage.totalBytes / (1024 ** 3),
    uptime: `${Math.floor(process.uptime() / 86400)}d ${Math.floor(process.uptime() % 86400 / 3600)}h`,
    camerasOnline: online,
    camerasTotal: cameras.length,
    recordingActive: storage.recordingProcesses > 0,
  }));
});

router.get("/nvr/storage", (_req, res): void => {
  try {
    res.json({ ...getStorageStatus(), locations: listStorageLocations() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Archivio non disponibile" });
  }
});

router.put("/nvr/storage", (req, res): void => {
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body.path !== "string" || !body.path.trim()) {
    res.status(400).json({ error: "Percorso archivio mancante" });
    return;
  }
  try {
    res.json(updateStorageConfig({
      path: body.path,
      retentionMode: body.retentionMode === "days" ? "days" : "auto",
      retentionDays: Number(body.retentionDays),
      reservePercent: Number(body.reservePercent),
      reserveGb: Number(body.reserveGb),
    }));
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "Configurazione archivio non valida" });
  }
});

// Manual camera sync / connection test endpoint
router.post("/nvr/sync", async (req, res): Promise<void> => {
  const config = getOrCreateNvrConfig();
  if (!config.host) {
    res.status(400).json({ error: "NVR not configured — set host and credentials first" });
    return;
  }
  const { online, reason } = await reolinkLogin(
    config.host,
    config.port,
    config.username,
    config.password,
  );
  autoSyncCameras(config, online);
  logger.info({ host: config.host, port: config.port, online, reason }, "nvr/sync eseguito");
  res.json({ success: true, online, reason, camerasCount: config.channelCount });
});

router.get("/recordings/play/:cameraId", (req, res): void => {
  const rawId = Array.isArray(req.params.cameraId) ? req.params.cameraId[0] : req.params.cameraId;
  const rawFile = typeof req.query.file === "string" ? req.query.file : "";
  const filePath = recordingFilePath(Number.parseInt(rawId, 10), rawFile);
  if (!filePath) { res.status(404).json({ error: "Registrazione non trovata" }); return; }
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.sendFile(filePath);
});

router.get("/recordings", (req, res): void => {
  const queryParsed = GetRecordingsQueryParams.safeParse(req.query);
  if (!queryParsed.success) { res.status(400).json({ error: queryParsed.error.message }); return; }
  const { cameraId, date } = queryParsed.data;
  res.json(GetRecordingsResponse.parse(listRecordedFiles(cameraId, date)));
});

export default router;
