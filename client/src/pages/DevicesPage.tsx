import { useState } from "react"
import { Wrench } from "lucide-react"
import type { FireNode, DeviceKind, NodeFault, FaultMode } from "@/types"

const KIND_LABEL: Record<DeviceKind, string> = {
  station: "Station", temp: "Temp", smoke: "Fumée", co: "CO",
  flame: "Flamme", thermal: "Thermique", wind: "Vent", fuel: "Combustible",
  rain: "Pluie", siren: "Sirène", gateway: "Passerelle",
}

const FAULT_COLOR: Record<NodeFault, string> = {
  ok:              "text-green-400",
  batterie_faible: "text-yellow-400",
  figé:            "text-blue-400",
  aberrant:        "text-red-400",
  dérive:          "text-orange-400",
  hors_ligne:      "text-zinc-500",
}

const FAULT_MODES: FaultMode[] = ["ok", "offline", "battery", "stuck", "drift", "spike", "noisy"]
const FAULT_LABEL: Record<FaultMode, string> = {
  ok: "OK", offline: "Hors ligne", battery: "Batterie", stuck: "Figé",
  drift: "Dérive", spike: "Aberrant", noisy: "Bruyant",
}

interface Props {
  nodes: FireNode[]
  sendCommand: (type: string, payload?: Record<string, unknown>) => void
}

function BattBar({ pct }: { pct?: number }) {
  if (pct == null) return <span className="text-muted-foreground">—</span>
  const color = pct > 50 ? "bg-green-500" : pct > 20 ? "bg-yellow-500" : "bg-red-500"
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 rounded-full bg-zinc-700">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono">{pct.toFixed(0)}%</span>
    </div>
  )
}

function DeviceDetail({ node, sendCommand, onClose }: {
  node: FireNode
  sendCommand: (type: string, payload?: Record<string, unknown>) => void
  onClose: () => void
}) {
  const r = node.readings
  return (
    <div className="border-t border-border bg-black/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm text-orange-400">{node.id}</span>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs font-mono">
        {r.temp    != null && <div><span className="text-muted-foreground">T </span>{r.temp.toFixed(1)}°C</div>}
        {r.hum     != null && <div><span className="text-muted-foreground">HR </span>{r.hum.toFixed(0)}%</div>}
        {r.smoke   != null && <div><span className="text-muted-foreground">Fumée </span>{r.smoke.toFixed(0)}ppm</div>}
        {r.co      != null && <div><span className="text-muted-foreground">CO </span>{r.co.toFixed(0)}ppm</div>}
        {r.wind_speed != null && <div><span className="text-muted-foreground">Vent </span>{r.wind_speed.toFixed(1)}m/s</div>}
        {r.wind_dir   != null && <div><span className="text-muted-foreground">Dir </span>{r.wind_dir.toFixed(0)}°</div>}
        {r.bat     != null && <div><span className="text-muted-foreground">Bat </span>{r.bat.toFixed(0)}%</div>}
        <div><span className="text-muted-foreground">Taille </span>{node.bytes} o</div>
        <div><span className="text-muted-foreground">Lat </span>{node.lat.toFixed(4)}</div>
        <div><span className="text-muted-foreground">Lon </span>{node.lon.toFixed(4)}</div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FAULT_MODES.map((m) => (
          <button
            key={m}
            onClick={() => sendCommand("device_fault", { id: node.id, mode: m })}
            className="px-2 py-0.5 text-[10px] rounded border border-border hover:border-zinc-500 transition-colors"
          >
            {FAULT_LABEL[m]}
          </button>
        ))}
      </div>
    </div>
  )
}

export function DevicesPage({ nodes, sendCommand }: Props) {
  const [filterStatus, setFilterStatus] = useState<"all" | NodeFault>("all")
  const [selected, setSelected] = useState<string | null>(null)

  const statuses: NodeFault[] = ["ok", "batterie_faible", "figé", "aberrant", "dérive", "hors_ligne"]
  const filtered = filterStatus === "all" ? nodes : nodes.filter((n) => n.status === filterStatus)

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-orange-400 uppercase tracking-widest">Appareils</h2>
        <div className="text-sm text-muted-foreground">
          {nodes.filter((n) => n.online).length}/{nodes.length} en ligne
        </div>
      </div>

      {/* Filtres par état */}
      <div className="flex flex-wrap gap-1.5">
        {(["all", ...statuses] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
              filterStatus === s
                ? "bg-orange-500/20 border-orange-500/60 text-orange-400"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {s === "all" ? "Tous" : s}
            {s !== "all" && (
              <span className="ml-1 opacity-60">{nodes.filter((n) => n.status === s).length}</span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-10">Aucun appareil.</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-black/40 text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">ID</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">État</th>
                <th className="text-left px-3 py-2">Batterie</th>
                <th className="text-left px-3 py-2">Temp</th>
                <th className="text-left px-3 py-2">Fumée</th>
                <th className="text-left px-3 py-2 w-6"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((node) => (
                <>
                  <tr
                    key={node.id}
                    onClick={() => setSelected(selected === node.id ? null : node.id)}
                    className={`border-t border-border/40 cursor-pointer transition-colors ${
                      selected === node.id ? "bg-orange-500/10" : "hover:bg-white/3"
                    } ${!node.online ? "opacity-50" : ""}`}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{node.id}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {KIND_LABEL[node.readings && "temp" in node.readings ? "station" : "station"] ?? "—"}
                    </td>
                    <td className={`px-3 py-2 text-xs font-medium ${FAULT_COLOR[node.status]}`}>
                      {node.status}
                    </td>
                    <td className="px-3 py-2">
                      <BattBar pct={node.readings?.bat} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {node.readings?.temp != null ? `${node.readings.temp.toFixed(1)}°C` : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {node.readings?.smoke != null ? `${node.readings.smoke.toFixed(0)}ppm` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Wrench className="w-3.5 h-3.5 text-muted-foreground/50" />
                    </td>
                  </tr>
                  {selected === node.id && (
                    <tr key={`${node.id}-detail`} className="bg-black/20">
                      <td colSpan={7} className="p-0">
                        <DeviceDetail
                          node={node}
                          sendCommand={sendCommand}
                          onClose={() => setSelected(null)}
                        />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
