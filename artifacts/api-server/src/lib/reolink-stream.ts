import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "./logger";

export interface ReolinkStreamConfig {
  sourceUrl?: string;
  transport?: "tcp" | "udp";
  host?: string;
  rtspPort?: number;
  username?: string;
  password?: string;
}

interface StreamState {
  process: ChildProcess | null;
  signature: string;
  directory: string;
  lastAccessAt: number;
  lastStartedAt: number;
  lastError: string;
}

const streams = new Map<number, StreamState>();
const STREAM_ROOT = path.join(os.tmpdir(), "reolink-nvr-hls");
const IDLE_TIMEOUT_MS = 30_000;
const RESTART_DELAY_MS = 3_000;
let shuttingDown = false;

function scrubCredentials(message: string): string {
  return message.replace(/rtsps?:\/\/[^@\s]+@/gi, "rtsp://***@");
}

function cleanHost(host: string): string {
  return host.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function streamSignature(config: ReolinkStreamConfig): string {
  return `${config.transport || "tcp"}:` + (config.sourceUrl || `${cleanHost(config.host || "")}:${config.rtspPort}:${config.username}:${config.password}`);
}

function rtspUrl(config: ReolinkStreamConfig, channel: number): string {
  if (config.sourceUrl) return config.sourceUrl;
  const username = encodeURIComponent(config.username || "");
  const password = encodeURIComponent(config.password || "");
  const channelId = String(channel).padStart(2, "0");
  return `rtsp://${username}:${password}@${cleanHost(config.host || "")}:${config.rtspPort}/h264Preview_${channelId}_sub`;
}

function stopState(channel: number, state: StreamState): void {
  if (state.process && !state.process.killed) {
    const child = state.process;
    child.kill("SIGTERM");
    const forceStop = setTimeout(() => child.kill("SIGKILL"), 2000);
    forceStop.unref();
    child.once("exit", () => clearTimeout(forceStop));
  }
  state.process = null;
  if (streams.get(channel) === state) streams.delete(channel);
  fs.rmSync(state.directory, { recursive: true, force: true });
}

function startStream(
  config: ReolinkStreamConfig,
  channel: number,
  existing?: StreamState,
): StreamState {
  if (existing) stopState(channel, existing);

  fs.mkdirSync(STREAM_ROOT, { recursive: true });
  const directory = fs.mkdtempSync(path.join(STREAM_ROOT, `channel-${channel}-`));

  const playlistPath = path.join(directory, "index.m3u8");
  const segmentPath = path.join(directory, "segment-%06d.ts");
  const args = [
    "-hide_banner",
    "-loglevel", "warning",
    "-rtsp_transport", config.transport || "tcp",
    "-timeout", "15000000",
    "-allowed_media_types", "video",
    "-fflags", "+genpts+discardcorrupt",
    "-use_wallclock_as_timestamps", "1",
    "-avoid_negative_ts", "make_zero",
    "-i", rtspUrl(config, channel),
    "-map", "0:v:0",
    "-an",
    "-c:v", "copy",
    "-f", "hls",
    "-hls_time", "1",
    "-hls_list_size", "5",
    "-hls_delete_threshold", "2",
    "-hls_flags", "delete_segments+omit_endlist+independent_segments+temp_file",
    "-hls_segment_filename", segmentPath,
    playlistPath,
  ];

  const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
  const now = Date.now();
  const state: StreamState = {
    process: child,
    signature: streamSignature(config),
    directory,
    lastAccessAt: now,
    lastStartedAt: now,
    lastError: "",
  };
  streams.set(channel, state);

  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk: string) => {
    state.lastError = scrubCredentials(`${state.lastError}${chunk}`).slice(-2000);
  });
  child.on("error", (error) => {
    state.process = null;
    state.lastError = error.message;
    logger.error({ channel, error: error.message }, "Impossibile avviare ffmpeg");
  });
  child.on("exit", (code, signal) => {
    state.process = null;
    if (code !== 0 && signal !== "SIGTERM") {
      logger.warn(
        { channel, code, signal, error: state.lastError },
        "Stream Reolink terminato",
      );
    }
  });

  logger.info({ cameraId: channel }, "Stream HLS telecamera avviato");
  return state;
}

export function ensureReolinkStream(
  config: ReolinkStreamConfig,
  channel: number,
): StreamState {
  if (shuttingDown) throw new Error("Server in arresto");
  const signature = streamSignature(config);
  const existing = streams.get(channel);
  const now = Date.now();

  if (existing?.process && existing.signature === signature) {
    existing.lastAccessAt = now;
    return existing;
  }

  if (
    existing &&
    existing.signature === signature &&
    now - existing.lastStartedAt < RESTART_DELAY_MS
  ) {
    existing.lastAccessAt = now;
    return existing;
  }

  return startStream(config, channel, existing);
}

export function getReolinkStreamFile(
  config: ReolinkStreamConfig,
  channel: number,
  filename: string,
): { filePath: string; state: StreamState } {
  const state = ensureReolinkStream(config, channel);
  state.lastAccessAt = Date.now();
  return { filePath: path.join(state.directory, filename), state };
}

export async function waitForStreamFile(
  filePath: string,
  timeoutMs = 12_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

interface LiveSession {
  signature: string;
  status: "starting" | "ready" | "failed";
  state?: StreamState;
  lastAccessAt: number;
  failedAt: number;
  attempt: number;
  attempts: number;
  detail: string;
}
const liveSessions = new Map<number, LiveSession>();
const preferredInputs = new Map<number, ReolinkStreamConfig>();
const STARTUP_ATTEMPT_MS = 25_000;

async function startLiveSession(channel: number, session: LiveSession, inputs: ReolinkStreamConfig[]): Promise<void> {
  const errors: string[] = [];
  try {
    for (const input of inputs) {
      if (shuttingDown || liveSessions.get(channel) !== session) return;
      session.attempt++;
      const state = ensureReolinkStream(input, channel);
      session.state = state;
      const playlist = path.join(state.directory, "index.m3u8");
      const deadline = Date.now() + STARTUP_ATTEMPT_MS;
      while (Date.now() < deadline && state.process) {
        if (shuttingDown || liveSessions.get(channel) !== session) return;
        // Poll requests keep this session alive; one background job owns FFmpeg.
        state.lastAccessAt = session.lastAccessAt;
        if (fs.existsSync(playlist) && fs.statSync(playlist).size > 0) {
          session.status = "ready";
          preferredInputs.set(channel, input);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      errors.push(`${input.transport?.toUpperCase()}: ${state.lastError || "Nessuna playlist video ricevuta entro 25 secondi."}`);
      stopState(channel, state);
    }
  } catch (error) {
    errors.push(scrubCredentials(error instanceof Error ? error.message : String(error)));
    if (session.state) stopState(channel, session.state);
  }
  if (liveSessions.get(channel) !== session) return;
  preferredInputs.delete(channel);
  session.status = "failed";
  session.failedAt = Date.now();
  session.detail = errors.join(" | ").slice(-2000);
  logger.warn({ cameraId: channel, detail: session.detail }, "Avvio video fallito dopo i tentativi RTSP");
}

// The HTTP request only polls progress. Parallel viewers share one startup job
// instead of cancelling each other's FFmpeg process while trying other URLs.
export function pollReolinkLive(sources: string[], channel: number, filename: string): {
  status: "starting" | "ready" | "failed" | "missing";
  filePath?: string;
  attempt?: number;
  attempts?: number;
  detail?: string;
} {
  if (shuttingDown) return { status: "failed", detail: "Server in arresto" };
  const signature = JSON.stringify(sources);
  let session = liveSessions.get(channel);
  const now = Date.now();
  if (session && (session.signature !== signature ||
      (session.status === "failed" && now - session.failedAt >= 5000) ||
      (session.status === "ready" && !session.state?.process))) {
    liveSessions.delete(channel);
    if (session.state) stopState(channel, session.state);
    session = undefined;
  }
  if (!session) {
    // A request for an old segment must never start or switch a camera source.
    if (filename !== "index.m3u8") return { status: "missing" };
    const inputs: ReolinkStreamConfig[] = (["tcp", "udp"] as const).flatMap(
      (transport) => sources.map((sourceUrl) => ({ sourceUrl, transport })),
    );
    const preferred = preferredInputs.get(channel);
    if (preferred) inputs.sort((a, b) => Number(streamSignature(b) === streamSignature(preferred)) - Number(streamSignature(a) === streamSignature(preferred)));
    session = { signature, status: "starting", lastAccessAt: now, failedAt: 0, attempt: 0, attempts: inputs.length, detail: "" };
    liveSessions.set(channel, session);
    void startLiveSession(channel, session, inputs);
  }
  session.lastAccessAt = now;
  if (session.state) session.state.lastAccessAt = now;
  if (session.status === "ready" && session.state) {
    const filePath = path.join(session.state.directory, filename);
    return fs.existsSync(filePath) ? { status: "ready", filePath } : { status: "missing" };
  }
  return { status: session.status, attempt: session.attempt, attempts: session.attempts, detail: session.detail };
}

setInterval(() => {
  const now = Date.now();
  for (const [channel, session] of liveSessions) {
    if (now - session.lastAccessAt > IDLE_TIMEOUT_MS) {
      liveSessions.delete(channel);
      preferredInputs.delete(channel);
      if (session.state) stopState(channel, session.state);
    }
  }
  for (const [channel, state] of streams) {
    if (now - state.lastAccessAt > IDLE_TIMEOUT_MS) stopState(channel, state);
  }
}, 10_000).unref();

function stopAllStreams(): void {
  shuttingDown = true;
  liveSessions.clear();
  preferredInputs.clear();
  for (const [channel, state] of [...streams]) stopState(channel, state);
}

process.once("SIGTERM", stopAllStreams);
process.once("SIGINT", stopAllStreams);
