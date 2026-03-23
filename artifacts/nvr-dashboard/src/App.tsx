import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import NotFound from "@/pages/not-found";
import { ThemeProvider } from "@/components/theme-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { StatusBar } from "@/components/status-bar";

import LiveView from "./pages/live-view";
import Recordings from "./pages/recordings";
import Settings from "./pages/settings";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={LiveView} />
      <Route path="/recordings" component={Recordings} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "4rem",
  } as React.CSSProperties;

  // Background image styling from generated assets
  const bgStyle = {
    backgroundImage: `url(${import.meta.env.BASE_URL}images/nvr-bg.png)`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundBlendMode: 'overlay',
    backgroundColor: 'rgba(10, 10, 12, 0.95)' // Very dark wash over the image
  };

  return (
    <ThemeProvider defaultTheme="dark" storageKey="nvr-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <SidebarProvider style={sidebarStyle}>
            <div className="flex h-screen w-full font-sans text-foreground overflow-hidden" style={bgStyle}>
              <AppSidebar />
              <div className="flex flex-col flex-1 min-w-0 bg-background/80 backdrop-blur-sm">
                <div className="flex relative">
                  <div className="absolute left-0 top-0 h-16 w-12 flex items-center justify-center z-20 md:hidden">
                    <SidebarTrigger className="text-foreground/70" />
                  </div>
                  <StatusBar />
                </div>
                <main className="flex-1 overflow-hidden relative">
                  <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                    <Router />
                  </WouterRouter>
                </main>
              </div>
            </div>
          </SidebarProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
