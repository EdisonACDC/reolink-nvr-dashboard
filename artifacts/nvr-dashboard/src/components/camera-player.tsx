import type { Camera } from "@workspace/api-client-react"
import { VideoPlayer } from "./video-player"
import { Badge } from "@/components/ui/badge"

interface CameraPlayerProps {
  camera: Camera
  className?: string
}

export function CameraPlayer({ camera, className = "" }: CameraPlayerProps) {
  const isOnline = camera.status === "online"
  const isRecording = camera.recordingEnabled && isOnline

  return (
    <div className={`relative flex flex-col bg-card rounded-xl overflow-hidden shadow-md shadow-black/20 border border-border/50 group ${className}`}>
      {/* Video Area */}
      <div className="flex-1 relative bg-black min-h-[200px]">
        {isOnline && camera.streamUrl ? (
          <VideoPlayer src={camera.streamUrl} />
        ) : (
          <VideoPlayer fallbackText={camera.name ? "Offline" : "Unconfigured"} />
        )}

        {/* Overlays */}
        <div className="absolute top-0 left-0 right-0 p-3 bg-gradient-to-b from-black/80 to-transparent flex justify-between items-start z-20 transition-opacity duration-300">
          <div className="flex items-center gap-2">
            <span className="text-white font-mono text-xs bg-black/50 px-2 py-1 rounded backdrop-blur-sm shadow-sm border border-white/10">
              CH{camera.channel.toString().padStart(2, '0')}
            </span>
            <span className="text-white font-medium text-sm drop-shadow-md">
              {camera.name || `Camera ${camera.channel}`}
            </span>
          </div>
          
          <div className="flex flex-col gap-2 items-end">
            {isRecording && (
              <div className="flex items-center gap-1.5 bg-black/50 px-2 py-1 rounded backdrop-blur-sm border border-destructive/30">
                <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                <span className="text-destructive font-bold text-[10px] tracking-widest uppercase">REC</span>
              </div>
            )}
            {!isOnline && (
              <Badge variant="destructive" className="bg-destructive/80 text-[10px] uppercase">Offline</Badge>
            )}
            {camera.motionDetection && isOnline && (
              <Badge variant="outline" className="bg-warning/20 text-warning border-warning/30 text-[10px] uppercase">Motion</Badge>
            )}
          </div>
        </div>
        
        {/* Play overlay hover effect (for future full-screen click) */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-primary/5 transition-colors duration-300 pointer-events-none z-10" />
      </div>
    </div>
  )
}
