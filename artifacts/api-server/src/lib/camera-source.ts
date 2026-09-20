import type { Camera, NvrConfig } from "../store/json-store";

function cleanHost(host: string): string {
  return host.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function addCredentials(rawUrl: string, username?: string, password?: string): string {
  if (!username || !rawUrl) return rawUrl;
  try {
    const url = new URL(rawUrl);
    if (!url.username) url.username = username;
    if (!url.password && password) url.password = password;
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function cameraRtspUrl(
  camera: Camera,
  config: NvrConfig,
  quality: "main" | "sub" = "main",
): string {
  if (camera.sourceType === "standalone" || camera.rtspUrl) {
    const selected = quality === "sub" && camera.subStreamUrl
      ? camera.subStreamUrl
      : camera.rtspUrl;
    return addCredentials(selected || "", camera.username, camera.password);
  }

  if (!config.host || !config.username || !config.password) return "";
  const username = encodeURIComponent(config.username);
  const password = encodeURIComponent(config.password);
  const channel = String(camera.channel).padStart(2, "0");
  return `rtsp://${username}:${password}@${cleanHost(config.host)}:${config.rtspPort}/h264Preview_${channel}_${quality}`;
}

export function publicRtspUrl(rawUrl?: string): string {
  if (!rawUrl) return "";
  try {
    const url = new URL(rawUrl);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return rawUrl.replace(/rtsp:\/\/[^@\s]+@/gi, "rtsp://");
  }
}

