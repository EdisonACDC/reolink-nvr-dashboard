import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { 
  useGetNvrConfig, 
  useUpdateNvrConfig, 
  useGetCameras,
  useCreateCamera,
  useUpdateCamera,
  useDeleteCamera,
  type Camera
} from "@workspace/api-client-react"
import { 
  Settings2, 
  Save, 
  Server, 
  Network, 
  Shield, 
  Plus,
  Trash2,
  Edit2,
  Camera as CameraIcon
} from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { useToast } from "@/hooks/use-toast"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"

// Zod schemas matching OpenAPI
const nvrConfigSchema = z.object({
  host: z.string().min(1, "Host is required"),
  port: z.coerce.number().min(1).max(65535),
  username: z.string().min(1, "Username is required"),
  password: z.string().optional(),
  rtspPort: z.coerce.number().min(1).max(65535),
  httpPort: z.coerce.number().min(1).max(65535),
  channelCount: z.coerce.number().min(1).max(128),
  name: z.string().min(1, "Name is required"),
})

const cameraSchema = z.object({
  channel: z.coerce.number().min(1),
  name: z.string().min(1, "Name is required"),
  recordingEnabled: z.boolean().default(true),
  motionDetection: z.boolean().default(true),
})

export default function Settings() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  
  // NVR Config Queries
  const { data: nvrConfig, isLoading: isNvrLoading } = useGetNvrConfig()
  const updateNvr = useUpdateNvrConfig()

  // Camera Queries
  const { data: cameras, isLoading: isCamerasLoading } = useGetCameras()
  const createCamera = useCreateCamera()
  const updateCamera = useUpdateCamera()
  const deleteCamera = useDeleteCamera()

  const [activeTab, setActiveTab] = useState("nvr")
  const [cameraDialogOpen, setCameraDialogOpen] = useState(false)
  const [editingCamera, setEditingCamera] = useState<Camera | null>(null)

  // Forms
  const nvrForm = useForm<z.infer<typeof nvrConfigSchema>>({
    resolver: zodResolver(nvrConfigSchema),
    values: nvrConfig ? {
      host: nvrConfig.host,
      port: nvrConfig.port,
      username: nvrConfig.username,
      password: "", // Don't populate password
      rtspPort: nvrConfig.rtspPort,
      httpPort: nvrConfig.httpPort,
      channelCount: nvrConfig.channelCount,
      name: nvrConfig.name
    } : undefined
  })

  const camForm = useForm<z.infer<typeof cameraSchema>>({
    resolver: zodResolver(cameraSchema),
    defaultValues: {
      channel: 1,
      name: "",
      recordingEnabled: true,
      motionDetection: true
    }
  })

  const onNvrSubmit = (values: z.infer<typeof nvrConfigSchema>) => {
    updateNvr.mutate({ data: values }, {
      onSuccess: () => {
        toast({ title: "NVR Configuration saved successfully" })
        queryClient.invalidateQueries({ queryKey: ['/api/nvr/config'] })
      },
      onError: (err: any) => {
        toast({ title: "Failed to save configuration", description: err.message, variant: "destructive" })
      }
    })
  }

  const openCameraDialog = (cam?: Camera) => {
    if (cam) {
      setEditingCamera(cam)
      camForm.reset({
        channel: cam.channel,
        name: cam.name,
        recordingEnabled: cam.recordingEnabled,
        motionDetection: cam.motionDetection
      })
    } else {
      setEditingCamera(null)
      // Auto-suggest next channel
      const nextCh = cameras ? Math.max(...cameras.map(c => c.channel), 0) + 1 : 1
      camForm.reset({ channel: nextCh, name: `Camera ${nextCh}`, recordingEnabled: true, motionDetection: true })
    }
    setCameraDialogOpen(true)
  }

  const onCameraSubmit = (values: z.infer<typeof cameraSchema>) => {
    if (editingCamera) {
      updateCamera.mutate({ id: editingCamera.id, data: values }, {
        onSuccess: () => {
          toast({ title: "Camera updated" })
          queryClient.invalidateQueries({ queryKey: ['/api/nvr/cameras'] })
          setCameraDialogOpen(false)
        }
      })
    } else {
      createCamera.mutate({ data: values }, {
        onSuccess: () => {
          toast({ title: "Camera added" })
          queryClient.invalidateQueries({ queryKey: ['/api/nvr/cameras'] })
          setCameraDialogOpen(false)
        }
      })
    }
  }

  const handleDeleteCamera = (id: number) => {
    if (confirm("Are you sure you want to remove this camera?")) {
      deleteCamera.mutate({ id }, {
        onSuccess: () => {
          toast({ title: "Camera removed" })
          queryClient.invalidateQueries({ queryKey: ['/api/nvr/cameras'] })
        }
      })
    }
  }

  return (
    <div className="flex flex-col h-full bg-background p-4 md:p-6 overflow-hidden">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Settings2 className="w-6 h-6 text-primary" /> Configuration
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Manage NVR connection and camera settings</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="w-full max-w-md grid grid-cols-2 mb-6 bg-card border border-border/50 p-1">
          <TabsTrigger value="nvr" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
            <Server className="w-4 h-4 mr-2" /> NVR System
          </TabsTrigger>
          <TabsTrigger value="cameras" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
            <CameraIcon className="w-4 h-4 mr-2" /> Cameras
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-auto pb-8">
          <TabsContent value="nvr" className="mt-0">
            <Card className="border-border/50 shadow-lg shadow-black/5 bg-card max-w-3xl">
              <CardHeader className="border-b border-border/50 bg-muted/10">
                <CardTitle>Connection Settings</CardTitle>
                <CardDescription>Enter the credentials to connect to your Reolink NVR on the local network.</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                {isNvrLoading ? (
                  <div className="space-y-4">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : (
                  <Form {...nvrForm}>
                    <form onSubmit={nvrForm.handleSubmit(onNvrSubmit)} className="space-y-6">
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField control={nvrForm.control} name="name" render={({ field }) => (
                          <FormItem>
                            <FormLabel>System Name</FormLabel>
                            <FormControl><Input {...field} className="bg-background" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        
                        <FormField control={nvrForm.control} name="channelCount" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Total Channels</FormLabel>
                            <FormControl><Input type="number" {...field} className="bg-background" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>

                      <div className="space-y-4 p-4 border border-border/50 rounded-xl bg-muted/5">
                        <h3 className="text-sm font-medium flex items-center gap-2 text-foreground"><Network className="w-4 h-4 text-primary" /> Network</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <FormField control={nvrForm.control} name="host" render={({ field }) => (
                            <FormItem className="col-span-1 md:col-span-2">
                              <FormLabel>IP Address / Hostname</FormLabel>
                              <FormControl><Input placeholder="192.168.1.100" {...field} className="bg-background" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          
                          <FormField control={nvrForm.control} name="port" render={({ field }) => (
                            <FormItem>
                              <FormLabel>API Port</FormLabel>
                              <FormControl><Input type="number" {...field} className="bg-background" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />

                          <FormField control={nvrForm.control} name="httpPort" render={({ field }) => (
                            <FormItem>
                              <FormLabel>HTTP Port</FormLabel>
                              <FormControl><Input type="number" {...field} className="bg-background" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />

                          <FormField control={nvrForm.control} name="rtspPort" render={({ field }) => (
                            <FormItem>
                              <FormLabel>RTSP Port</FormLabel>
                              <FormControl><Input type="number" {...field} className="bg-background" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                      </div>

                      <div className="space-y-4 p-4 border border-border/50 rounded-xl bg-muted/5">
                        <h3 className="text-sm font-medium flex items-center gap-2 text-foreground"><Shield className="w-4 h-4 text-primary" /> Authentication</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <FormField control={nvrForm.control} name="username" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Username</FormLabel>
                              <FormControl><Input {...field} className="bg-background" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          
                          <FormField control={nvrForm.control} name="password" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Password</FormLabel>
                              <FormControl><Input type="password" placeholder="Leave blank to keep unchanged" {...field} className="bg-background" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                      </div>

                      <div className="flex justify-end pt-4">
                        <Button type="submit" disabled={updateNvr.isPending} className="w-full md:w-auto shadow-md shadow-primary/20">
                          {updateNvr.isPending ? "Saving..." : <><Save className="w-4 h-4 mr-2" /> Save Configuration</>}
                        </Button>
                      </div>
                    </form>
                  </Form>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="cameras" className="mt-0 space-y-4">
            <div className="flex justify-between items-center max-w-4xl">
              <h2 className="text-lg font-semibold text-foreground">Configured Cameras</h2>
              <Button onClick={() => openCameraDialog()} size="sm" className="bg-primary/20 text-primary hover:bg-primary/30 hover:text-primary">
                <Plus className="w-4 h-4 mr-2" /> Add Camera
              </Button>
            </div>

            <Card className="border-border/50 shadow-lg shadow-black/5 bg-card max-w-4xl overflow-hidden">
              <div className="grid grid-cols-12 gap-4 p-4 border-b border-border/50 bg-muted/20 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <div className="col-span-1 text-center">CH</div>
                <div className="col-span-4">Name</div>
                <div className="col-span-3">Features</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>

              <div className="flex flex-col">
                {isCamerasLoading ? (
                  <div className="p-4 space-y-3">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : !cameras?.length ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <CameraIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p>No cameras configured yet.</p>
                  </div>
                ) : (
                  cameras.map(cam => (
                    <div key={cam.id} className="grid grid-cols-12 gap-4 p-4 items-center border-b border-border/10 last:border-0 hover:bg-secondary/30 transition-colors group">
                      <div className="col-span-1 text-center font-mono text-muted-foreground">{cam.channel}</div>
                      <div className="col-span-4 font-medium">{cam.name}</div>
                      <div className="col-span-3 flex gap-2">
                        {cam.recordingEnabled && <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded border border-primary/20">REC</span>}
                        {cam.motionDetection && <span className="text-[10px] bg-warning/10 text-warning px-2 py-0.5 rounded border border-warning/20">MOTION</span>}
                      </div>
                      <div className="col-span-2">
                        <div className={`flex items-center gap-1.5 text-xs font-medium ${cam.status === 'online' ? 'text-success' : 'text-destructive'}`}>
                          <div className={`w-1.5 h-1.5 rounded-full ${cam.status === 'online' ? 'bg-success' : 'bg-destructive'}`} />
                          {cam.status}
                        </div>
                      </div>
                      <div className="col-span-2 flex justify-end gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openCameraDialog(cam)}>
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/20" onClick={() => handleDeleteCamera(cam.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Dialog open={cameraDialogOpen} onOpenChange={setCameraDialogOpen}>
              <DialogContent className="bg-card border-border/50">
                <DialogHeader>
                  <DialogTitle>{editingCamera ? "Edit Camera" : "Add Camera"}</DialogTitle>
                </DialogHeader>
                <Form {...camForm}>
                  <form onSubmit={camForm.handleSubmit(onCameraSubmit)} className="space-y-4 pt-4">
                    <div className="grid grid-cols-4 gap-4">
                      <FormField control={camForm.control} name="channel" render={({ field }) => (
                        <FormItem className="col-span-1">
                          <FormLabel>Channel</FormLabel>
                          <FormControl><Input type="number" {...field} className="bg-background" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={camForm.control} name="name" render={({ field }) => (
                        <FormItem className="col-span-3">
                          <FormLabel>Camera Name</FormLabel>
                          <FormControl><Input {...field} className="bg-background" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    
                    <div className="space-y-4 pt-2 border-t border-border/50">
                      <FormField control={camForm.control} name="recordingEnabled" render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border/50 p-3 shadow-sm bg-background/50">
                          <div className="space-y-0.5">
                            <FormLabel>Enable Recording</FormLabel>
                            <FormDescription className="text-xs">Save stream to NVR storage</FormDescription>
                          </div>
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </FormItem>
                      )} />

                      <FormField control={camForm.control} name="motionDetection" render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border/50 p-3 shadow-sm bg-background/50">
                          <div className="space-y-0.5">
                            <FormLabel>Motion Detection</FormLabel>
                            <FormDescription className="text-xs">Trigger alerts on movement</FormDescription>
                          </div>
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </FormItem>
                      )} />
                    </div>

                    <div className="flex justify-end pt-4 gap-2">
                      <Button type="button" variant="outline" onClick={() => setCameraDialogOpen(false)}>Cancel</Button>
                      <Button type="submit" disabled={createCamera.isPending || updateCamera.isPending}>
                        {editingCamera ? "Save Changes" : "Add Camera"}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
