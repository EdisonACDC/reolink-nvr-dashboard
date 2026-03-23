import { useEffect, useRef, useState } from "react"
import Hls from "hls.js"
import { VideoOff, Loader2 } from "lucide-react"

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

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    setLoading(true)
    setError(false)

    let hls: Hls | null = null

    if (src.includes(".m3u8") && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      })
      
      hls.loadSource(src)
      hls.attachMedia(video)
      
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false)
        if (autoPlay) {
          video.play().catch(e => console.log("Autoplay prevented:", e))
        }
      })

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.error("HLS Error:", data)
          setError(true)
          setLoading(false)
        }
      })
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Native Safari support
      video.src = src
      video.addEventListener('loadedmetadata', () => {
        setLoading(false)
        if (autoPlay) {
          video.play().catch(e => console.log("Autoplay prevented:", e))
        }
      })
      video.addEventListener('error', () => {
        setError(true)
        setLoading(false)
      })
    } else {
      // Standard MP4 or other native supported format
      video.src = src
      video.addEventListener('canplay', () => setLoading(false))
      video.addEventListener('error', () => {
        setError(true)
        setLoading(false)
      })
    }

    return () => {
      if (hls) {
        hls.destroy()
      }
    }
  }, [src, autoPlay])

  if (!src || error) {
    return (
      <div className={`flex flex-col items-center justify-center bg-black/90 text-muted-foreground w-full h-full border border-border/10 ${className}`}>
        <VideoOff className="w-8 h-8 mb-2 opacity-50" />
        <span className="text-sm font-medium tracking-wide uppercase">{fallbackText}</span>
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
