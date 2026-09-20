import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cameraRtspUrl } from "./camera-source";
import { logger } from "./logger";
import { jsonStore, type Camera, type StorageConfig } from "../store/json-store";

const GB = 1024 ** 3;
const SEGMENT_SECONDS = Math.min(900, Math.max(10, Number(process.env.NVR_SEGMENT_SECONDS) || 300));
const recorderProcesses = new Map<number, ChildProcess>();
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
  const child = recorderProcesses.get(cameraId);
  if (child && !child.killed) child.kill("SIGTERM");
  recorderProcesses.delete(cameraId);
}

function startRecorder(camera: Camera): void {
  const nvrConfig = jsonStore.getNvrConfig();
  if (!nvrConfig) return;
  const input = cameraRtspUrl(camera, nvrConfig, "main");
  if (!input) return;

  const storage = jsonStore.getStorageConfig();
  const outputDir = path.join(recordingsRoot(storage), `camera-${camera.id}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const output = path.join(outputDir, "%Y-%m-%d_%H-%M-%S.mp4");
  const inputArgs = input.startsWith("rtsp://") || input.startsWith("rtsps://")
    ? ["-rtsp_transport", "tcp", "-rw_timeout", "10000000", "-i", input]
    : ["-re", "-stream_loop", "-1", "-i", input];
  const args = [
    "-hide_banner", "-loglevel", "warning",
    ...inputArgs,
    "-map", "0:v:0", "-map", "0:a?",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "64k",
    "-f", "segment",
    "-segment_format", "mp4",
    "-segment_time", String(SEGMENT_SECONDS),
    "-reset_timestamps", "1",
    "-strftime", "1",
    output,
  ];
  const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
  recorderProcesses.set(camera.id, child);
  jsonStore.updateCamera(camera.id, { status: "online" });
  let errorText = "";
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk: string) => {
    errorText = `${errorText}${chunk}`
      .replace(/rtsp:\/\/[^@\s]+@/gi, "rtsp://***@")
      .slice(-2000);
    lastErrors.set(camera.id, errorText);
  });
  child.on("error", (error) => {
    lastErrors.set(camera.id, error.message);
    recorderProcesses.delete(camera.id);
    jsonStore.updateCamera(camera.id, { status: "offline" });
  });
  child.on("exit", (code, signal) => {
    recorderProcesses.delete(camera.id);
    if (code !== 0) jsonStore.updateCamera(camera.id, { status: "offline" });
    if (code !== 0 && signal !== "SIGTERM") {
      logger.warn({ cameraId: camera.id, code, error: errorText }, "Registrazione interrotta");
    }
  });
  logger.info({ cameraId: camera.id, name: camera.name }, "Registrazione avviata");
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
  let files = recordingFiles(config).sort((a, b) => a.mtimeMs - b.mtimeMs);
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
      if (file.mtimeMs < now - days * 86_400_000 || file.mtimeMs < globalCutoff && !camera) {
        fs.rmSync(file.path, { force: true });
      }
    }
  }

  let numbers = storageNumbers(config);
  files = recordingFiles(config).sort((a, b) => a.mtimeMs - b.mtimeMs);
  while (numbers.freeBytes < numbers.reservedBytes && files.length > 1) {
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
    if (!config) return;
    const storage = storageNumbers(jsonStore.getStorageConfig());
    const diskSafe = storage.freeBytes > storage.reservedBytes;
    for (const camera of jsonStore.getCameras(config.id)) {
      const mode = camera.recordingMode || (camera.recordingEnabled ? "continuous" : "off");
      const shouldRecord = diskSafe && camera.recordingEnabled && mode === "continuous";
      if (shouldRecord && !recorderProcesses.has(camera.id)) startRecorder(camera);
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
    recordingProcesses: recorderProcesses.size,
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

export function listRecordedFiles(cameraId?: number, date?: string) {
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
      if (stats.size < 1024 || Date.now() - stats.mtimeMs < 2_000) continue;
      result.push({
        id: id++, cameraId: camera.id, cameraName: camera.name,
        startTime,
        endTime: new Date(new Date(startTime).getTime() + SEGMENT_SECONDS * 1000).toISOString(),
        duration: SEGMENT_SECONDS, fileSize: stats.size, type: "continuous",
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
  return fs.existsSync(candidate) ? candidate : null;
}

export function recorderCameraError(cameraId: number): string {
  return lastErrors.get(cameraId) || "";
}

setInterval(reconcileRecorders, 10_000).unref();
setTimeout(reconcileRecorders, 2_000).unref();

function stopAll(): void {
  shuttingDown = true;
  for (const id of [...recorderProcesses.keys()]) stopRecorder(id);
}
process.once("SIGTERM", stopAll);
process.once("SIGINT", stopAll);
