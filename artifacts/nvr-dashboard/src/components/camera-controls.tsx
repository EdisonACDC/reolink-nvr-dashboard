import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ArrowUpLeft, ArrowUpRight, ArrowDownLeft, ArrowDownRight, Minus, Plus, Move } from "lucide-react";
import { resolveAppUrl } from "@/lib/app-url";

type Capabilities = { pan: boolean; tilt: boolean; speed: boolean; telephoto: boolean; zoom: { min: number; max: number; position: number } | null };
export function CameraControls({ cameraId, telephoto, onLensChange }: { cameraId: number; telephoto: boolean; onLensChange: (value: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [speed, setSpeed] = useState(8);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const endpoint = resolveAppUrl(`./api/nvr/cameras/${cameraId}/ptz`);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch(endpoint, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Comandi non disponibili"); return data; })
      .then(data => { if (!controller.signal.aborted) setCaps(data); })
      .catch(error => { if (!controller.signal.aborted) { setCaps(null); setError(error.message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, endpoint]);
  async function command(action: string) {
    const isStop = action === "Stop";
    if (!isStop && inFlight.current) return;
    if (!isStop) { inFlight.current = true; setBusy(true); }
    setError(""); setMessage("");
    if (action.startsWith("Zoom") && caps?.telephoto) onLensChange(true);
    try {
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, speed }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Comando non riuscito");
      if (mounted.current) setMessage(isStop ? "STOP inviato" : action.startsWith("Zoom") ? "Zoom impostato" : "Movimento completato");
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : "Comando non riuscito");
    } finally {
      if (!isStop) { inFlight.current = false; if (mounted.current) setBusy(false); }
    }
  }
  const arrows = [
    ["LeftUp", "In alto a sinistra", ArrowUpLeft], ["Up", "Su", ArrowUp], ["RightUp", "In alto a destra", ArrowUpRight],
    ["Left", "Sinistra", ArrowLeft], ["Stop", "Ferma telecamera", null], ["Right", "Destra", ArrowRight],
    ["LeftDown", "In basso a sinistra", ArrowDownLeft], ["Down", "Giù", ArrowDown], ["RightDown", "In basso a destra", ArrowDownRight],
  ] as const;
  return <div className="border-t border-border/60 bg-card p-3">
    <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2 text-sm font-semibold hover:bg-secondary" aria-expanded={open} aria-controls={`ptz-${cameraId}`} onClick={() => setOpen(value => !value)}>
      <span className="flex items-center gap-2"><Move size={18} /> Controlla telecamera</span>{open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
    </button>
    {open && <div id={`ptz-${cameraId}`} className="mt-3 space-y-3">
      {loading && <p className="text-sm text-muted-foreground" role="status">Caricamento comandi…</p>}
      {!loading && caps && <>
        {caps.telephoto && <div className="flex gap-2" aria-label="Lente della telecamera">
          <button type="button" aria-pressed={!telephoto} className={`min-h-11 flex-1 rounded-lg border px-2 text-sm ${!telephoto ? "bg-primary text-primary-foreground" : "bg-secondary"}`} onClick={() => onLensChange(false)}>Panoramica</button>
          <button type="button" aria-pressed={telephoto} className={`min-h-11 flex-1 rounded-lg border px-2 text-sm ${telephoto ? "bg-primary text-primary-foreground" : "bg-secondary"}`} onClick={() => onLensChange(true)}>Lente zoom</button>
        </div>}
        {(caps.pan || caps.tilt) && <>
          <div className="mx-auto grid max-w-[240px] grid-cols-3 gap-2">
            {arrows.map(([action, label, Icon]) => <button type="button" key={action} aria-label={label}
              disabled={action !== "Stop" && (busy || (/Left|Right/.test(action) && !caps.pan) || (/Up|Down/.test(action) && !caps.tilt))}
              onClick={() => void command(action)}
              className={`flex min-h-12 touch-manipulation items-center justify-center rounded-lg border font-bold disabled:opacity-40 ${action === "Stop" ? "bg-destructive text-destructive-foreground text-xs" : "bg-secondary active:bg-primary active:text-primary-foreground"}`}>
              {Icon ? <Icon size={22} /> : "STOP"}
            </button>)}
          </div>
          <p className="text-center text-xs text-muted-foreground">Tocca una freccia per un breve movimento. Arresto automatico.</p>
          {caps.speed && <label className="flex items-center gap-3 text-sm">Velocità
            <select aria-label="Velocità movimento" value={speed} disabled={busy} onChange={event => setSpeed(Number(event.target.value))} className="min-h-11 flex-1 rounded-lg border bg-background px-3">
              <option value={4}>Lenta</option><option value={8}>Normale</option><option value={16}>Veloce</option>
            </select>
          </label>}
        </>}
        {caps.zoom && <div className="flex items-center justify-center gap-3">
          <button type="button" aria-label="Riduci zoom" disabled={busy} onClick={() => void command("ZoomOut")} className="flex min-h-12 min-w-12 items-center justify-center rounded-lg border bg-secondary disabled:opacity-40"><Minus /></button>
          <span className="text-sm font-medium">Zoom</span>
          <button type="button" aria-label="Aumenta zoom" disabled={busy} onClick={() => void command("ZoomIn")} className="flex min-h-12 min-w-12 items-center justify-center rounded-lg border bg-secondary disabled:opacity-40"><Plus /></button>
        </div>}
        {!caps.pan && !caps.tilt && !caps.zoom && <p className="text-sm text-muted-foreground">Questa telecamera non espone comandi di movimento o zoom.</p>}
        {caps.telephoto && caps.zoom && <p className="text-xs text-muted-foreground">Lo zoom agisce sulla seconda lente: la vista passa automaticamente a “Lente zoom”.</p>}
      </>}
      <div aria-live="polite" className="text-sm">{busy ? "Invio comando…" : message}</div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!caps && !loading && <button type="button" className="min-h-11 rounded-lg border px-3 text-sm" onClick={() => { setOpen(false); }}>Chiudi e riprova</button>}
    </div>}
  </div>;
}
