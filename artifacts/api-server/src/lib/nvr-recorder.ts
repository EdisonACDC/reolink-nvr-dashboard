import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cameraRtspUrls } from "./camera-source";
import { logger } from "./logger";
import { jsonStore, type Camera, type StorageConfig } from "../store/json-store";

const GB = 1024 ** 3;
const SEGMENT_SECONDS = Math.min(900, Math.max(10, Number(process.env.NVR_SEGMENT_SECONDS) || 300));
interface RecorderState {
  child: ChildProcess;
  signature: string;
  startedAt: number;
  lastPacketAt: number;
  outputDir: string;
  completedList: string;
  inputIndex: number;
}
const recorderProcesses = new Map<number, RecorderState>();
const nextInputs = new Map<number, { signature: string; index: number }>();
const retryAfter = new Map<number, number>();

function recorderInputs(camera: Camera) {
  const config = jsonStore.getNvrConfig();
  if (!config) return [];
  const urls = cameraRtspUrls(camera, config, "main");
  return (["tcp", "udp"] as const).flatMap(transport => urls.map(url => ({ url, transport })));
}
function recorderSignature(camera: Camera): string {
  return JSON.stringify(recorderInputs(camera));
}
function incompleteFile(filePath: string): boolean {
  for (const state of recorderProcesses.values()) {
    if (path.dirname(filePath) !== state.outputDir || fs.statSync(filePath).mtimeMs < state.startedAt) continue;
    const completed = fs.existsSync(state.completedList) ? fs.readFileSync(state.completedList, "utf8").split("\n") : [];
    return !completed.includes(filePath) && !completed.includes(path.basename(filePath));
  }
  return false;
}

export function recorderCameraStatus(cameraId: number): "off" | "starting" | "recording" | "error" {
  const camera = jsonStore.getCameraById(cameraId);
  if (camera?.nvrOnline === false && camera.sourceType !== "standalone" && !camera.rtspUrl) return "off";
  if (!camera?.recordingEnabled || camera.recordingMode === "off" || camera.recordingMode === "motion") return "off";
  const state = recorderProcesses.get(cameraId);
  if (!state) return lastErrors.has(cameraId) ? "error" : "starting";
  // Advancing media timestamps alone are not enough: a file must actually have been written.
  if (state.lastPacketAt && Date.now() - state.lastPacketAt < 30_000 && fs.existsSync(state.outputDir) &&
      fs.readdirSync(state.outputDir).some(name => name.endsWith(".mp4") && (() => {
        const stat = fs.statSync(path.join(state.outputDir, name));
        return stat.size > 1024 && stat.mtimeMs >= state.startedAt && Date.now() - stat.mtimeMs < 30_000;
      })())) return "recording";
  return "starting";
}
const lastErrors = new Map<number, string>();
let shuttingDown = false;

export interface StorageStatus {
  path: string;
  totalBytes: number;
  freeBytes: number;
  recordingsBytes: number;
  reservedBytes: number;
  availableForRecordingsBytes: number;
  estimatedDays: number | null;
  retentionMode: "auto" | "days";
  retentionDays: number;
  reservePercent: number;
  reserveGb: number;
  recordingProcesses: number;
  warning: string | null;
}

function safeStoragePath(rawPath: string): string {
  const resolved = path.resolve(rawPath || "/media/reolink-nvr");
  const allowed = ["/media", "/share", "/data"];
  if (!allowed.some((root) => resolved === root || resolved.startsWith(`${root}/`))) {
    throw new Error("Il percorso deve trovarsi in /media, /share oppure /data");
  }
  return resolved;
}

function recordingsRoot(config: StorageConfig): string {
  return path.join(safeStoragePath(config.path), "recordings");
}

function directorySize(directory: string): number {
  if (!fs.existsSync(directory)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += directorySize(fullPath);
    else if (entry.isFile()) total += fs.statSync(fullPath).size;
  }
  return total;
}

function storageNumbers(config: StorageConfig) {
  const target = safeStoragePath(config.path);
  fs.mkdirSync(target, { recursive: true });
  const stats = fs.statfsSync(target);
  const totalBytes = stats.blocks * stats.bsize;
  const freeBytes = stats.bavail * stats.bsize;
  const reservedBytes = Math.max(
    config.reserveGb * GB,
    Math.floor(totalBytes * (config.reservePercent / 100)),
  );
  const recordingsBytes = directorySize(recordingsRoot(config));
  return {
    totalBytes,
    freeBytes,
    reservedBytes,
    recordingsBytes,
    availableForRecordingsBytes: Math.max(0, freeBytes - reservedBytes),
  };
}

function stopRecorder(cameraId: number): void {
  const state = recorderProcesses.get(cameraId);
  if (!state || state.child.killed) return;
  // Keep the state until close: do not start another writer in the same folder.
  state.child.kill("SIGTERM");
  const timer = setTimeout(() => state.child.kill("SIGKILL"), 2000);
  timer.unref();
  state.child.once("close", () => clearTimeout(timer));
}

function startRecorder(camera: Camera): void {
  const inputs = recorderInputs(camera);
  if (!inputs.length) { lastErrors.set(camera.id, "Flusso video non configurato"); return; }
  const signature = recorderSignature(camera);
  const previous = nextInputs.get(camera.id);
  const inputIndex = previous?.signature === signature ? previous.index % inputs.length : 0;
  const input = inputs[inputIndex];
  const storage = jsonStore.getStorageConfig();
  const outputDir = path.join(recordingsRoot(storage), `camera-${camera.id}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const completedList = path.join(outputDir, ".completed-segments");
  fs.writeFileSync(completedList, "");
  const output = path.join(outputDir, "%Y-%m-%d_%H-%M-%S.mp4");
  const inputArgs = /^rtsps?:/.test(input.url)
    ? ["-rtsp_transport", input.transport, "-timeout", "10000000", "-i", input.url]
    : ["-re", "-stream_loop", "-1", "-i", input.url];
  const args = [
    "-hide_banner", "-loglevel", "warning", "-nostdin",
    ...inputArgs,
    "-map", "0:v:0", "-map", "0:a?",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "64k",
    "-progress", "pipe:1", "-stats_period", "1",
    "-f", "segment", "-segment_format", "mp4",
    "-segment_time", String(SEGMENT_SECONDS),
    "-segment_list", completedList, "-segment_list_type", "flat",
    "-reset_timestamps", "1", "-strftime", "1", output,
  ];
  const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
  const state: RecorderState = { child, signature, startedAt: Date.now(), lastPacketAt: 0, outputDir, completedList, inputIndex };
  recorderProcesses.set(camera.id, state);
  lastErrors.delete(camera.id);
  let errorText = "";
  let progressBuffer = "";
  let lastTimestamp = -1;
  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => {
    progressBuffer += chunk;
    const lines = progressBuffer.split("\n");
    progressBuffer = lines.pop() || "";
    for (const line of lines) {
      const match = line.match(/^out_time_us=(-?\d+)/);
      if (match && Number(match[1]) > lastTimestamp) {
        lastTimestamp = Number(match[1]);
        state.lastPacketAt = Date.now();
        nextInputs.set(camera.id, { signature, index: inputIndex });
        if (jsonStore.getCameraById(camera.id)?.status !== "online") jsonStore.updateCamera(camera.id, { status: "online" });
      }
    }
  });
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk: string) => {
    errorText = `${errorText}${chunk}`.replace(/rtsps?:\/\/[^@\s]+@/gi, "rtsp://***@").slice(-2000);
  });
  child.on("error", error => { errorText = error.message; });
  child.on("close", (code, signal) => {
    if (recorderProcesses.get(camera.id) !== state) return;
    recorderProcesses.delete(camera.id);
    if (signal === "SIGTERM" || signal === "SIGKILL" || shuttingDown) return;
    lastErrors.set(camera.id, errorText || `Flusso interrotto (codice ${code})`);
    nextInputs.set(camera.id, { signature, index: (inputIndex + 1) % inputs.length });
    retryAfter.set(camera.id, Date.now() + 2000);
    logger.warn({ cameraId: camera.id, code, error: errorText }, "Registrazione interrotta: prossimo indirizzo/trasporto al nuovo tentativo");
  });
  logger.info({ cameraId: camera.id, attempt: inputIndex + 1, attempts: inputs.length }, "Collegamento registrazione in corso");
}

function recordingFiles(config: StorageConfig): Array<{ path: string; mtimeMs: number; size: number }> {
  const root = recordingsRoot(config);
  if (!fs.existsSync(root)) return [];
  const files: Array<{ path: string; mtimeMs: number; size: number }> = [];
  for (const cameraDir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!cameraDir.isDirectory()) continue;
    const directory = path.join(root, cameraDir.name);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".mp4")) continue;
      const filePath = path.join(directory, entry.name);
      const stats = fs.statSync(filePath);
      files.push({ path: filePath, mtimeMs: stats.mtimeMs, size: stats.size });
    }
  }
  return files;
}

function cleanupRecordings(): void {
  const config = jsonStore.getStorageConfig();
  let files = recordingFiles(config).filter(file => !incompleteFile(file.path)).sort((a, b) => a.mtimeMs - b.mtimeMs);
  const now = Date.now();

  if (config.retentionMode === "days") {
    const globalCutoff = now - config.retentionDays * 86_400_000;
    const cameras = new Map((jsonStore.getNvrConfig()
      ? jsonStore.getCameras(jsonStore.getNvrConfig()!.id)
      : []).map((camera) => [camera.id, camera]));
    for (const file of files) {
      const match = file.path.match(/camera-(\d+)/);
      const camera = match ? cameras.get(Number(match[1])) : undefined;
      const days = camera?.retentionDays ?? config.retentionDays;
      if (!incompleteFile(file.path) && (file.mtimeMs < now - days * 86_400_000 || file.mtimeMs < globalCutoff && !camera)) {
        fs.rmSync(file.path, { force: true });
      }
    }
  }

  let numbers = storageNumbers(config);
  files = recordingFiles(config).filter(file => !incompleteFile(file.path)).sort((a, b) => a.mtimeMs - b.mtimeMs);
  while (numbers.freeBytes < numbers.reservedBytes && files.length > 0) {
    const oldest = files.shift()!;
    fs.rmSync(oldest.path, { force: true });
    numbers = storageNumbers(config);
  }
}

function reconcileRecorders(): void {
  if (shuttingDown) return;
  try {
    cleanupRecordings();
    const config = jsonStore.getNvrConfig();
    if (!config) { for (const id of recorderProcesses.keys()) stopRecorder(id); return; }
    const cameras = jsonStore.getCameras(config.id);
    for (const id of recorderProcesses.keys()) if (!cameras.some(camera => camera.id === id)) stopRecorder(id);
    const storage = storageNumbers(jsonStore.getStorageConfig());
    const diskSafe = storage.freeBytes > storage.reservedBytes;
    for (const camera of cameras) {
      const mode = camera.recordingMode || (camera.recordingEnabled ? "continuous" : "off");
      const available = camera.sourceType === "standalone" || !!camera.rtspUrl || camera.nvrOnline !== false;
      const shouldRecord = available && diskSafe && camera.recordingEnabled && mode === "continuous";
      const running = recorderProcesses.get(camera.id);
      if (running && running.signature !== recorderSignature(camera)) stopRecorder(camera.id);
      if (shouldRecord && !running && Date.now() >= (retryAfter.get(camera.id) || 0)) startRecorder(camera);
      if (running && Date.now() - (running.lastPacketAt || running.startedAt) > 45_000) {
        lastErrors.set(camera.id, "Nessun nuovo fotogramma: riconnessione in corso");
        const next = (running.inputIndex + 1) % Math.max(1, recorderInputs(camera).length);
        nextInputs.set(camera.id, { signature: running.signature, index: next });
        stopRecorder(camera.id);
      }
      if (!shouldRecord && recorderProcesses.has(camera.id)) stopRecorder(camera.id);
    }
  } catch (error: any) {
    logger.error({ error: error?.message }, "Errore supervisore registrazioni");
  }
}

export function getStorageStatus(): StorageStatus {
  const config = jsonStore.getStorageConfig();
  const numbers = storageNumbers(config);
  const files = recordingFiles(config);
  const oldestTime = files.length ? Math.min(...files.map((file) => file.mtimeMs)) : Date.now();
  const elapsedDays = Math.max((Date.now() - oldestTime) / 86_400_000, 5 / 1440);
  const bytesPerDay = numbers.recordingsBytes / elapsedDays;
  const usableCapacity = Math.max(0, numbers.totalBytes - numbers.reservedBytes);
  const estimatedDays = bytesPerDay > 0 && numbers.recordingsBytes >= 1024 ** 2
    ? usableCapacity / bytesPerDay
    : null;
  return {
    path: safeStoragePath(config.path),
    ...numbers,
    estimatedDays: estimatedDays === null ? null : Math.round(estimatedDays * 10) / 10,
    retentionMode: config.retentionMode,
    retentionDays: config.retentionDays,
    reservePercent: config.reservePercent,
    reserveGb: config.reserveGb,
    recordingProcesses: [...recorderProcesses.keys()].filter(id => recorderCameraStatus(id) === "recording").length,
    warning: numbers.freeBytes <= numbers.reservedBytes
      ? "Spazio di sicurezza raggiunto: registrazioni sospese"
      : null,
  };
}

export function updateStorageConfig(input: Partial<StorageConfig>): StorageStatus {
  const next = {
    ...jsonStore.getStorageConfig(),
    ...input,
  };
  next.path = safeStoragePath(next.path);
  next.retentionDays = Math.min(3650, Math.max(1, Number(next.retentionDays) || 7));
  next.reservePercent = Math.min(50, Math.max(5, Number(next.reservePercent) || 15));
  next.reserveGb = Math.min(1000, Math.max(5, Number(next.reserveGb) || 20));
  fs.mkdirSync(next.path, { recursive: true });
  jsonStore.updateStorageConfig(next);
  for (const cameraId of [...recorderProcesses.keys()]) stopRecorder(cameraId);
  reconcileRecorders();
  return getStorageStatus();
}

export function listStorageLocations(): Array<{ path: string; label: string }> {
  const locations = [
    { path: "/data/recordings", label: "Disco dati Home Assistant" },
    { path: "/media/reolink-nvr", label: "Archivio Media Home Assistant" },
  ];
  for (const root of ["/media", "/share"]) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const candidate = path.join(root, entry.name, "reolink-nvr");
        if (!locations.some((item) => item.path === candidate)) {
          locations.push({ path: candidate, label: `${root === "/media" ? "Media" : "Share"}: ${entry.name}` });
        }
      }
    }
  }
  return locations;
}

const durationCache = new Map<string, { signature: string; duration: number | null }>();
async function recordingDuration(filePath: string, stats: fs.Stats): Promise<number | null> {
  const signature = `${stats.size}:${stats.mtimeMs}`;
  const cached = durationCache.get(filePath);
  if (cached?.signature === signature) return cached.duration;
  const duration = await new Promise<number | null>(resolve => {
    const child = spawn("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name:format=duration", "-of", "json", filePath]);
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.stdout.on("data", chunk => { output = (output + chunk).slice(-10000); });
    child.on("error", () => { clearTimeout(timer); resolve(null); });
    child.on("close", code => {
      clearTimeout(timer);
      try {
        const probe = JSON.parse(output);
        const value = Number(probe.format?.duration);
        resolve(code === 0 && probe.streams?.length && Number.isFinite(value) && value > 0 ? value : null);
      } catch { resolve(null); }
    });
  });
  if (durationCache.size > 1000) durationCache.delete(durationCache.keys().next().value!);
  durationCache.set(filePath, { signature, duration });
  return duration;
}

export async function listRecordedFiles(cameraId?: number, date?: string) {
  const config = jsonStore.getStorageConfig();
  const root = recordingsRoot(config);
  if (!fs.existsSync(root)) return [];
  const nvr = jsonStore.getNvrConfig();
  const cameras = nvr ? jsonStore.getCameras(nvr.id) : [];
  const selected = cameraId ? cameras.filter((c) => c.id === cameraId) : cameras;
  let id = 1;
  const result: Array<Record<string, unknown>> = [];
  for (const camera of selected) {
    const directory = path.join(root, `camera-${camera.id}`);
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => b.name.localeCompare(a.name))) {
      const match = entry.name.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})\.mp4$/);
      if (!entry.isFile() || !match || date && match[1] !== date) continue;
      const startTime = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}`).toISOString();
      const stats = fs.statSync(path.join(directory, entry.name));
      const filePath = path.join(directory, entry.name);
      if (stats.size < 1024 || incompleteFile(filePath)) continue;
      const duration = await recordingDuration(filePath, stats);
      if (duration === null) continue;
      result.push({
        id: id++, cameraId: camera.id, cameraName: camera.name,
        startTime,
        endTime: new Date(new Date(startTime).getTime() + duration * 1000).toISOString(),
        duration, fileSize: stats.size, type: "continuous",
        playbackUrl: `./api/recordings/play/${camera.id}?file=${encodeURIComponent(entry.name)}`,
      });
    }
  }
  return result;
}

export function recordingFilePath(cameraId: number, filename: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.mp4$/.test(filename)) return null;
  const config = jsonStore.getStorageConfig();
  const candidate = path.join(recordingsRoot(config), `camera-${cameraId}`, filename);
  return fs.existsSync(candidate) && !incompleteFile(candidate) ? candidate : null;
}

export function recorderCameraError(cameraId: number): string {
  return lastErrors.get(cameraId) || "";
}

setInterval(reconcileRecorders, 10_000).unref();
setTimeout(reconcileRecorders, 2_000).unref();

export async function shutdownRecorders(): Promise<void> {
  shuttingDown = true;
  const closed = [...recorderProcesses].map(([id, state]) => new Promise<void>(resolve => {
    state.child.once("close", () => resolve());
    stopRecorder(id);
  }));
  await Promise.all(closed);
}
function stopAll(): void { void shutdownRecorders(); }
process.once("SIGTERM", stopAll);
process.once("SIGINT", stopAll);

