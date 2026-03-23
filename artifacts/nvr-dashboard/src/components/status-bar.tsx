import { useGetNvrStatus } from "@workspace/api-client-react"
import { Activity, HardDrive, Server, Thermometer, Wifi, WifiOff } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"

export function StatusBar() {
  const { data: status, isLoading } = useGetNvrStatus({
    query: {
      refetchInterval: 10000, // Poll every 10s
    }
  })

  if (isLoading) {
    return (
      <header className="h-16 border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex items-center justify-end px-6 gap-6 z-10 w-full">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-24" />
      </header>
    )
  }

  const isConnected = status?.connected ?? false
  const diskPercentage = status ? (status.diskUsage / status.diskTotal) * 100 : 0

  return (
    <header className="h-16 border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex items-center justify-between px-6 z-10 w-full shadow-sm">
      
      <div className="flex items-center gap-4">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${isConnected ? 'bg-success/10 border-success/20 text-success' : 'bg-destructive/10 border-destructive/20 text-destructive'}`}>
          {isConnected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
          <span className="text-xs font-semibold uppercase tracking-wider">{isConnected ? 'System Online' : 'Offline'}</span>
        </div>
        
        {status?.recordingActive && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border bg-destructive/10 border-destructive/20 text-destructive animate-pulse">
            <div className="w-2 h-2 rounded-full bg-destructive" />
            <span className="text-xs font-semibold uppercase tracking-wider">Recording</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-6 text-sm">
        {status && (
          <>
            <div className="flex flex-col gap-1.5 min-w-[200px]">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><HardDrive className="w-3.5 h-3.5" /> Storage</span>
                <span className="font-mono">{diskPercentage.toFixed(1)}%</span>
              </div>
              <Progress value={diskPercentage} className="h-1.5" />
            </div>

            <div className="h-8 w-px bg-border/50 mx-2" />

            <div className="flex items-center gap-6 text-muted-foreground">
              <div className="flex items-center gap-2" title="Cameras Online">
                <Activity className="w-4 h-4 text-primary" />
                <span className="font-mono text-foreground font-medium">{status.camerasOnline}/{status.camerasTotal}</span>
              </div>
              
              {status.temperature && (
                <div className="flex items-center gap-2" title="System Temperature">
                  <Thermometer className="w-4 h-4 text-warning" />
                  <span className="font-mono text-foreground font-medium">{status.temperature}°C</span>
                </div>
              )}

              {status.uptime && (
                <div className="flex items-center gap-2" title="Uptime">
                  <Server className="w-4 h-4 text-muted-foreground" />
                  <span className="font-mono text-foreground">{status.uptime}</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </header>
  )
}
