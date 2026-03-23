import { useState } from "react"
import { useGetCameras } from "@workspace/api-client-react"
import { CameraPlayer } from "@/components/camera-player"
import { LayoutGrid, Grip, Maximize, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export default function LiveView() {
  const { data: cameras, isLoading, error } = useGetCameras({
    query: {
      refetchInterval: 15000, // Refetch status every 15s
    }
  })

  const [gridSize, setGridSize] = useState<1 | 4 | 9 | 16>(4)

  if (error) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="bg-destructive/10 text-destructive p-6 rounded-xl border border-destructive/20 flex flex-col items-center max-w-md text-center">
          <AlertCircle className="w-12 h-12 mb-4 opacity-80" />
          <h2 className="text-lg font-bold mb-2">Failed to load cameras</h2>
          <p className="text-sm opacity-80">Could not connect to the NVR. Please check your configuration and network connection.</p>
        </div>
      </div>
    )
  }

  // Pad the array to fill the grid size if needed for the UI aesthetic
  const displayCameras = cameras || []
  const paddedCameras = Array.from({ length: Math.max(gridSize, displayCameras.length) }).map((_, i) => {
    return displayCameras[i] || {
      id: -i,
      channel: i + 1,
      name: `Unconfigured CH${i+1}`,
      status: "offline",
      recordingEnabled: false,
      motionDetection: false,
      nvrId: 0
    }
  }).slice(0, gridSize)

  return (
    <div className="flex flex-col h-full bg-background p-4 md:p-6 overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Live View</h1>
          <p className="text-sm text-muted-foreground mt-1">Real-time monitoring from configured channels</p>
        </div>

        <div className="flex items-center gap-2 bg-card p-1 rounded-lg border border-border/50 shadow-sm">
          <Button 
            variant={gridSize === 1 ? "secondary" : "ghost"} 
            size="sm" 
            className="h-8 px-3"
            onClick={() => setGridSize(1)}
            data-testid="button-grid-1"
          >
            <Maximize className="w-4 h-4 mr-2" /> 1
          </Button>
          <Button 
            variant={gridSize === 4 ? "secondary" : "ghost"} 
            size="sm" 
            className="h-8 px-3"
            onClick={() => setGridSize(4)}
            data-testid="button-grid-4"
          >
            <LayoutGrid className="w-4 h-4 mr-2" /> 4
          </Button>
          <Button 
            variant={gridSize === 9 ? "secondary" : "ghost"} 
            size="sm" 
            className="h-8 px-3"
            onClick={() => setGridSize(9)}
            data-testid="button-grid-9"
          >
            <Grip className="w-4 h-4 mr-2" /> 9
          </Button>
          <Button 
            variant={gridSize === 16 ? "secondary" : "ghost"} 
            size="sm" 
            className="h-8 px-3"
            onClick={() => setGridSize(16)}
            data-testid="button-grid-16"
          >
            <LayoutGrid className="w-4 h-4 mr-2 opacity-50" /> 16
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-xl">
        {isLoading ? (
          <div className={`grid gap-4 h-full w-full camera-grid-${gridSize}`}>
            {Array.from({ length: gridSize }).map((_, i) => (
              <Skeleton key={i} className="w-full h-full min-h-[200px] rounded-xl" />
            ))}
          </div>
        ) : (
          <div className={`grid gap-4 h-full w-full camera-grid-${gridSize}`}>
            {paddedCameras.map((camera) => (
              <CameraPlayer 
                key={camera.id} 
                camera={camera as any} 
                className="w-full h-full"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
