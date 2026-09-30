import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface Playback {
  directory: string;
  child: ChildProcess | null;
  touched: number;
  failed: boolean;
}
const sessions = new Map<string, Playback>();
const IDLE_MS = 10 * 60_000;
const MAX_SESSIONS = 2;

function stop(key: string, state: Playback) {
  sessions.delete(key);
  if (state.child) {
    const child = state.child;
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
    timer.unref();
    child.once("close", () => { clearTimeout(timer); fs.rmSync(state.directory, { recursive: true, force: true }); });
  } else fs.rmSync(state.directory, { recursive: true, force: true });
}

// H.265 originals remain untouched. A bounded, temporary H.264 viewing copy
// supports iOS/Android/desktop through the same authenticated HA ingress.
export function pollRecordingPlayback(filePath: string, filename: string): {
  status: "starting" | "ready" | "failed" | "missing" | "busy";
  filePath?: string;
} {
  if (!/^(index\.m3u8|segment-\d{6}\.ts)$/.test(filename)) return { status: "missing" };
  const stats = fs.statSync(filePath);
  const key = `${filePath}:${stats.size}:${stats.mtimeMs}`;
  let state = sessions.get(key);
  if (state?.failed && filename === "index.m3u8" && Date.now() - state.touched > 5000) {
    stop(key, state);
    state = undefined;
  }
  if (!state) {
    if (filename !== "index.m3u8") return { status: "missing" };
    for (const [oldKey, old] of sessions) if (Date.now() - old.touched > IDLE_MS) stop(oldKey, old);
    if (sessions.size >= MAX_SESSIONS) {
      // Never evict a playing viewer; old completed previews can be discarded.
      const oldest = [...sessions].filter(([, item]) => !item.child && Date.now() - item.touched > 30_000)
        .sort((a, b) => a[1].touched - b[1].touched)[0];
      if (!oldest) return { status: "busy" };
      stop(oldest[0], oldest[1]);
    }
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "reolink-playback-"));
    const child = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "2", "-i", filePath,
      "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "ultrafast",
      "-vf", "scale=w='min(1280,iw)':h=-2,fps=15,format=yuv420p",
      "-threads", "2", "-crf", "25", "-g", "30", "-sc_threshold", "0",
      "-c:a", "aac", "-b:a", "64k", "-t", "900",
      "-f", "hls", "-hls_time", "2", "-hls_list_size", "0", "-hls_playlist_type", "event",
      "-hls_flags", "independent_segments+temp_file",
      "-hls_segment_filename", path.join(directory, "segment-%06d.ts"),
      path.join(directory, "index.m3u8"),
    ], { stdio: "ignore" });
    state = { directory, child, touched: Date.now(), failed: false };
    sessions.set(key, state);
    const current = state;
    const timer = setTimeout(() => { current.failed = true; child.kill("SIGKILL"); }, 15 * 60_000);
    timer.unref();
    child.once("error", () => { current.failed = true; });
    child.once("close", code => {
      clearTimeout(timer);
      current.child = null;
      if (code !== 0) current.failed = true;
    });
  }
  state.touched = Date.now();
  if (state.failed) return { status: "failed" };
  const output = path.join(state.directory, filename);
  if (fs.existsSync(output) && fs.statSync(output).size > 0) return { status: "ready", filePath: output };
  return { status: state.child ? "starting" : "missing" };
}
setInterval(() => {
  for (const [key, state] of sessions) if (Date.now() - state.touched > IDLE_MS) stop(key, state);
}, 30_000).unref();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  for (const [key, state] of [...sessions]) stop(key, state);
});
