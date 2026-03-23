import { useState } from "react"
import { useGetRecordings, useGetCameras, type Recording } from "@workspace/api-client-react"
import { format } from "date-fns"
import { Calendar as CalendarIcon, Play, HardDrive, Filter, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { VideoPlayer } from "@/components/video-player"
import { Skeleton } from "@/components/ui/skeleton"

export default function Recordings() {
  const [date, setDate] = useState<Date>(new Date())
  const [cameraId, setCameraId] = useState<string>("all")
  const [selectedVideo, setSelectedVideo] = useState<Recording | null>(null)

  const { data: cameras } = useGetCameras()
  
  const formattedDate = format(date, "yyyy-MM-dd")
  
  const { data: recordings, isLoading } = useGetRecordings({
    query: {
      queryKey: ['/api/recordings', { date: formattedDate, cameraId: cameraId === "all" ? undefined : parseInt(cameraId) }]
    }
  }, {
    request: {
      // Pass params to URL
    } as any // The generated hook might need specific params structure, we just pass what forces reactivity
  })

  // Re-map the query hook properly based on generated spec structure
  const activeRecordings = useGetRecordings({
    cameraId: cameraId === "all" ? undefined : parseInt(cameraId),
    date: formattedDate
  }).data

  const isLoadingRecords = useGetRecordings({ date: formattedDate }).isLoading

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}m ${s}s`
  }

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return "Unknown"
    const mb = bytes / (1024 * 1024)
    return `${mb.toFixed(1)} MB`
  }

  return (
    <div className="flex flex-col h-full bg-background p-4 md:p-6 overflow-hidden">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Recordings</h1>
          <p className="text-sm text-muted-foreground mt-1">Browse and playback stored footage</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Select value={cameraId} onValueChange={setCameraId}>
            <SelectTrigger className="w-[180px] bg-card border-border/50">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-muted-foreground" />
                <SelectValue placeholder="All Cameras" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Cameras</SelectItem>
              {cameras?.map(cam => (
                <SelectItem key={cam.id} value={cam.id.toString()}>{cam.name || `CH${cam.channel}`}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-[240px] justify-start text-left font-normal bg-card border-border/50">
                <CalendarIcon className="mr-2 h-4 w-4 text-primary" />
                {date ? format(date, "PPP") : <span>Pick a date</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={date}
                onSelect={(d) => d && setDate(d)}
                initialFocus
                className="bg-card"
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="flex-1 bg-card rounded-xl border border-border/50 shadow-lg shadow-black/5 overflow-hidden flex flex-col">
        <div className="grid grid-cols-12 gap-4 p-4 border-b border-border/50 bg-muted/20 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <div className="col-span-3">Time</div>
          <div className="col-span-3">Camera</div>
          <div className="col-span-2">Type</div>
          <div className="col-span-2">Duration</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        <div className="flex-1 overflow-auto p-2">
          {isLoadingRecords ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center p-4 mb-2">
                <Skeleton className="h-6 w-full" />
              </div>
            ))
          ) : !activeRecordings || activeRecordings.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
              <HardDrive className="w-16 h-16 mb-4 opacity-20" />
              <h3 className="text-lg font-medium text-foreground">No recordings found</h3>
              <p className="text-sm mt-1 max-w-md">No video footage was found for the selected date and camera filters. Try changing your search parameters.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {activeRecordings.map((rec) => (
                <div 
                  key={rec.id} 
                  className="grid grid-cols-12 gap-4 p-4 items-center rounded-lg hover:bg-secondary/50 transition-colors border border-transparent hover:border-border/50 group"
                >
                  <div className="col-span-3 font-mono text-sm">
                    {format(new Date(rec.startTime), "HH:mm:ss")} - {format(new Date(rec.endTime), "HH:mm:ss")}
                  </div>
                  <div className="col-span-3 font-medium text-sm">
                    {rec.cameraName}
                  </div>
                  <div className="col-span-2">
                    <Badge variant={rec.type === 'motion' ? 'destructive' : 'secondary'} className={rec.type === 'motion' ? 'bg-destructive/20 text-destructive hover:bg-destructive/30' : ''}>
                      {rec.type}
                    </Badge>
                  </div>
                  <div className="col-span-2 text-sm text-muted-foreground">
                    {formatDuration(rec.duration)} <span className="opacity-50 text-xs ml-1">({formatFileSize(rec.fileSize)})</span>
                  </div>
                  <div className="col-span-2 flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-primary hover:bg-primary/20" onClick={() => setSelectedVideo(rec)}>
                      <Play className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                      <Download className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!selectedVideo} onOpenChange={(open) => !open && setSelectedVideo(null)}>
        <DialogContent className="max-w-4xl p-0 bg-black border-border overflow-hidden">
          <DialogHeader className="p-4 absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black/80 to-transparent">
            <DialogTitle className="text-white drop-shadow-md">
              {selectedVideo?.cameraName} - {selectedVideo && format(new Date(selectedVideo.startTime), "PPP HH:mm:ss")}
            </DialogTitle>
          </DialogHeader>
          <div className="aspect-video w-full bg-black relative">
            {selectedVideo && (
              <VideoPlayer 
                src={selectedVideo.playbackUrl} 
                controls 
                autoPlay 
                className="w-full h-full"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
