import { Link, useLocation } from "wouter"
import { MonitorPlay, Settings, Video, ShieldCheck } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function AppSidebar() {
  const [location] = useLocation()

  const navItems = [
    { title: "Live View", icon: MonitorPlay, path: "/" },
    { title: "Recordings", icon: Video, path: "/recordings" },
    { title: "Configuration", icon: Settings, path: "/settings" },
  ]

  return (
    <Sidebar variant="inset" className="border-r border-border/50 bg-sidebar">
      <SidebarHeader className="h-16 flex items-center px-4 border-b border-border/50">
        <div className="flex items-center gap-3 w-full">
          <div className="bg-primary/20 p-2 rounded-lg text-primary">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold tracking-tight text-sm text-foreground">Reolink NVR</span>
            <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wider">Dashboard v1.0</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-widest text-muted-foreground/70 font-semibold mb-2">
            Monitoring
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = location === item.path
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link 
                        href={item.path}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 ${
                          isActive 
                            ? "bg-primary/10 text-primary font-medium" 
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                        }`}
                      >
                        <item.icon className={`w-5 h-5 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
