import { useEffect, useRef, useState } from "react"
import Hls from "hls.js"
import { VideoOff, Loader2, RotateCcw } from "lucide-react"
import { resolveAppUrl } from "@/lib/app-url"

interface VideoPlayerProps {
  src?: string
  autoPlay?: boolean
  muted?: boolean
  controls?: boolean
  className?: string
  fallbackText?: string
}

export function VideoPlayer({ 
  src, 
  autoPlay = true, 
  muted = true, 
  controls = false,
  className = "",
  fallbackText = "No signal"
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    const streamUrl = resolveAppUrl(src)

    setLoading(true)
    setError(false)

    let hls: Hls | null = null
    let mediaRecoveryAttempted = false
    const startupTimer = window.setTimeout(() => {
      setError(true)
      setLoading(false)
    }, 20_000)

    const markReady = () => {
      window.clearTimeout(startupTimer)
      setLoading(false)
      if (autoPlay) {
        video.play().catch(e => console.log("Autoplay prevented:", e))
      }
    }

    const markError = () => {
      window.clearTimeout(startupTimer)
      setError(true)
      setLoading(false)
    }

    if (src.includes(".m3u8") && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 4,
      })
      
      hls.loadSource(streamUrl)
      hls.attachMedia(video)
      
      hls.on(Hls.Events.MANIFEST_PARSED, markReady)

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (!data.fatal) return
        console.error("HLS Error:", data)
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecoveryAttempted) {
          mediaRecoveryAttempted = true
          hls?.recoverMediaError()
          return
        }
        markError()
      })
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Native Safari support
      video.src = streamUrl
      video.addEventListener('loadedmetadata', markReady)
      video.addEventListener('error', markError)
    } else {
      // Standard MP4 or other native supported format
      video.src = streamUrl
      video.addEventListener('canplay', markReady)
      video.addEventListener('error', markError)
    }

    return () => {
      window.clearTimeout(startupTimer)
      video.removeEventListener('loadedmetadata', markReady)
      video.removeEventListener('canplay', markReady)
      video.removeEventListener('error', markError)
      if (hls) {
        hls.destroy()
      }
    }
  }, [src, autoPlay, retryToken])

  if (!src || error) {
    return (
      <div className={`flex flex-col items-center justify-center bg-black/90 text-muted-foreground w-full h-full border border-border/10 ${className}`}>
        <VideoOff className="w-8 h-8 mb-2 opacity-50" />
        <span className="text-sm font-medium tracking-wide uppercase">{fallbackText}</span>
        {src && (
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-2 rounded-md border border-white/20 px-3 py-1.5 text-xs text-white hover:bg-white/10"
            onClick={() => setRetryToken(value => value + 1)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Riprova
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={`relative w-full h-full bg-black overflow-hidden group ${className}`}>
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      )}
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        autoPlay={autoPlay}
        muted={muted}
        controls={controls}
        playsInline
      />
    </div>
  )
}
