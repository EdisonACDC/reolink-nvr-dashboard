import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { VideoOff, Loader2, RotateCcw } from "lucide-react";
import { resolveAppUrl } from "@/lib/app-url";

interface VideoPlayerProps {
  src?: string;
  autoPlay?: boolean;
  muted?: boolean;
  controls?: boolean;
  className?: string;
  fallbackText?: string;
}

export function VideoPlayer({
  src,
  autoPlay = true,
  muted = true,
  controls = false,
  className = "",
  fallbackText = "No signal",
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(false);
  const [detail, setDetail] = useState("");
  const [loading, setLoading] = useState(true);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const streamUrl = resolveAppUrl(src);

    setLoading(true);
    setError(false);
    setDetail("");

    let disposed = false;
    const controller = new AbortController();
    let hls: Hls | null = null;
    let mediaRecoveryAttempted = false;
    const startupTimer = window.setTimeout(() => {
      controller.abort();
      setDetail("Il video non è partito entro 35 secondi. Premi Riprova.");
      setError(true);
      setLoading(false);
    }, 35_000);

    const markReady = () => {
      if (disposed || controller.signal.aborted) return;
      window.clearTimeout(startupTimer);
      setLoading(false);
      setError(false);
      if (autoPlay) {
        video.play().catch((e) => console.log("Autoplay prevented:", e));
      }
    };

    const markError = () => {
      if (disposed) return;
      window.clearTimeout(startupTimer);
      setError(true);
      setLoading(false);
    };

    const start = async () => {
      try {
        if (src.includes(".m3u8")) {
          const response = await fetch(streamUrl, {
            signal: controller.signal,
            cache: "no-store",
            credentials: "same-origin",
          });
          if (!response.ok) {
            let message = `Flusso non disponibile (HTTP ${response.status}).`;
            try {
              const data = await response.json();
              message = [data.error || message, data.detail]
                .filter(Boolean)
                .join(" ")
                .slice(0, 700);
            } catch {}
            throw new Error(message);
          }
          if (!(await response.text()).trimStart().startsWith("#EXTM3U"))
            throw new Error(
              "Risposta video non valida. Riapri il pannello dall'app Home Assistant.",
            );
        }
        if (disposed || controller.signal.aborted) return;
        if (
          src.includes(".m3u8") &&
          !video.canPlayType("application/vnd.apple.mpegurl") &&
          Hls.isSupported()
        ) {
          hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            manifestLoadingMaxRetry: 4,
            manifestLoadingRetryDelay: 1000,
            levelLoadingMaxRetry: 4,
            fragLoadingMaxRetry: 4,
          });

          hls.loadSource(streamUrl);
          hls.attachMedia(video);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (autoPlay) video.play().catch(markError);
          });
          video.addEventListener("canplay", markReady);

          hls.on(Hls.Events.ERROR, (event, data) => {
            if (!data.fatal) return;
            setDetail(
              `Errore video: ${data.details}. Verifica RTSP e sub-stream H.264.`,
            );
            if (
              data.type === Hls.ErrorTypes.MEDIA_ERROR &&
              !mediaRecoveryAttempted
            ) {
              mediaRecoveryAttempted = true;
              hls?.recoverMediaError();
              return;
            }
            markError();
          });
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          // Native Safari support
          video.src = streamUrl;
          video.addEventListener("canplay", markReady);
          video.load();
          if (autoPlay) video.play().catch(markError);
          video.addEventListener("error", markError);
        } else {
          // Standard MP4 or other native supported format
          video.src = streamUrl;
          video.addEventListener("canplay", markReady);
          video.addEventListener("error", markError);
        }
      } catch (err) {
        if (!disposed && !controller.signal.aborted) {
          setDetail(
            err instanceof Error ? err.message : "Flusso non disponibile",
          );
          markError();
        }
      }
    };
    void start();
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(startupTimer);
      video.removeEventListener("loadedmetadata", markReady);
      video.removeEventListener("canplay", markReady);
      video.removeEventListener("error", markError);
      if (hls) hls.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [src, autoPlay, retryToken]);

  return (
    <div className={`nvr-video-player ${className}`}>
      <video
        ref={videoRef}
        className="nvr-video-element"
        autoPlay={autoPlay}
        muted={muted}
        controls={controls}
        playsInline
      />
      {src && loading && !error && (
        <div className="nvr-video-message">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <span>Avvio video…</span>
        </div>
      )}
      {(!src || error) && (
        <div className="nvr-video-message" role={error ? "alert" : "status"}>
          <VideoOff className="w-8 h-8 opacity-50" />
          <span>
            {error
              ? detail ||
                "Video non disponibile. Verifica RTSP e il codec H.264 del sub-stream."
              : fallbackText}
          </span>
          {src && (
            <button
              type="button"
              className="nvr-video-retry"
              onClick={() => setRetryToken((value) => value + 1)}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Riprova
            </button>
          )}
        </div>
      )}
    </div>
  );
}
