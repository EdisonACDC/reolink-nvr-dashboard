import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "./logger";

export interface ReolinkStreamConfig {
  host: string;
  rtspPort: number;
  username: string;
  password: string;
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

function scrubCredentials(message: string): string {
  return message.replace(/rtsp:\/\/[^@\s]+@/gi, "rtsp://***@");
}

function cleanHost(host: string): string {
  return host.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function streamSignature(config: ReolinkStreamConfig): string {
  return `${cleanHost(config.host)}:${config.rtspPort}:${config.username}:${config.password}`;
}

function rtspUrl(config: ReolinkStreamConfig, channel: number): string {
  const username = encodeURIComponent(config.username);
  const password = encodeURIComponent(config.password);
  const channelId = String(channel).padStart(2, "0");
  return `rtsp://${username}:${password}@${cleanHost(config.host)}:${config.rtspPort}/h264Preview_${channelId}_sub`;
}

function stopState(channel: number, state: StreamState): void {
  if (state.process && !state.process.killed) {
    state.process.kill("SIGTERM");
  }
  state.process = null;
  streams.delete(channel);
  fs.rmSync(state.directory, { recursive: true, force: true });
}

function startStream(
  config: ReolinkStreamConfig,
  channel: number,
  existing?: StreamState,
): StreamState {
  if (existing) stopState(channel, existing);

  const directory = path.join(STREAM_ROOT, `channel-${channel}`);
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });

  const playlistPath = path.join(directory, "index.m3u8");
  const segmentPath = path.join(directory, "segment-%06d.ts");
  const args = [
    "-hide_banner",
    "-loglevel", "warning",
    "-rtsp_transport", "tcp",
    "-rw_timeout", "7000000",
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

  logger.info({ channel, host: cleanHost(config.host) }, "Stream HLS Reolink avviato");
  return state;
}

export function ensureReolinkStream(
  config: ReolinkStreamConfig,
  channel: number,
): StreamState {
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

setInterval(() => {
  const now = Date.now();
  for (const [channel, state] of streams) {
    if (now - state.lastAccessAt > IDLE_TIMEOUT_MS) stopState(channel, state);
  }
}, 10_000).unref();

function stopAllStreams(): void {
  for (const [channel, state] of [...streams]) stopState(channel, state);
}

process.once("SIGTERM", stopAllStreams);
process.once("SIGINT", stopAllStreams);
