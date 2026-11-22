import { Fragment, useState } from "react"
import { Wrench, ChevronDown, ChevronRight } from "lucide-react"
import type { FireNode, DeviceKind, NodeFault, NodeReadings, FaultMode } from "@/types"

const KIND_LABEL: Record<DeviceKind, string> = {
  station: "Station", temp: "Temp.", smoke: "Fumée", co: "CO",
  flame: "Flamme", thermal: "Thermique", wind: "Vent", fuel: "Combustible",
  rain: "Pluie", siren: "Sirène", gateway: "Passerelle",
}

const STATUS_COLOR: Record<NodeFault, string> = {
  ok:              "#30d158",
  batterie_faible: "#ffd60a",
  figé:            "#0a84ff",
  aberrant:        "#ff3b30",
  dérive:          "#ff9f0a",
  hors_ligne:      "#636366",
}

const STATUS_LABEL: Record<NodeFault, string> = {
  ok: "OK", batterie_faible: "Batterie", figé: "Figé",
  aberrant: "Aberrant", dérive: "Dérive", hors_ligne: "Offline",
}

const FAULT_MODES: FaultMode[] = ["ok", "offline", "battery", "stuck", "drift", "spike", "noisy"]
const FAULT_MODE_LABEL: Record<FaultMode, string> = {
  ok: "OK", offline: "Offline", battery: "Batterie", stuck: "Figé",
  drift: "Dérive", spike: "Aberrant", noisy: "Bruyant",
}

function inferKind(r: NodeReadings): DeviceKind {
  if (r.tmax != null) return "thermal"
  if (r.wind_speed != null && r.smoke == null && r.temp == null) return "wind"
  if (r.flame != null && r.smoke == null && r.temp == null) return "flame"
  if (r.co != null && r.smoke == null && r.temp == null) return "co"
  if (r.smoke != null && r.temp == null) return "smoke"
  if (r.fmc != null) return "fuel"
  if (r.rain != null) return "rain"
  return "station"
}

function BattBar({ pct }: { pct?: number }) {
  if (pct == null) return <span style={{ color: "rgba(235,235,245,0.25)" }}>—</span>
  const color = pct > 50 ? "#30d158" : pct > 20 ? "#ffd60a" : "#ff3b30"
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-12 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.10)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, transition: "width 0.4s ease" }} />
      </div>
      <span className="text-[10px] tabular" style={{ color: "rgba(235,235,245,0.5)" }}>{pct.toFixed(0)}%</span>
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
    <div className="px-4 py-3 anim-down" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.20)" }}>
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[11px] font-mono" style={{ color: "#ff9f0a" }}>{node.id}</span>
        <button onClick={onClose} className="spring-hover w-5 h-5 flex items-center justify-center rounded-full text-white/40 hover:text-white/70"
          style={{ background: "rgba(255,255,255,0.08)" }}>
          <span className="text-[10px]">✕</span>
        </button>
      </div>

      {/* Mesures en grille compacte */}
      <div className="grid grid-cols-4 gap-x-3 gap-y-2 mb-3">
        {r.temp    != null && <Metric label="Temp" val={`${r.temp.toFixed(1)}°C`} />}
        {r.hum     != null && <Metric label="HR"   val={`${r.hum.toFixed(0)}%`} />}
        {r.smoke   != null && <Metric label="Fumée" val={`${r.smoke.toFixed(0)}`} unit="ppm" />}
        {r.co      != null && <Metric label="CO"   val={`${r.co.toFixed(0)}`}   unit="ppm" />}
        {r.wind_speed != null && <Metric label="Vent" val={`${r.wind_speed.toFixed(1)}`} unit="m/s" />}
        {r.wind_dir   != null && <Metric label="Dir"  val={`${r.wind_dir.toFixed(0)}°`} />}
        {r.bat     != null && <Metric label="Bat"  val={`${r.bat.toFixed(0)}%`} />}
        <Metric label="Taille" val={`${node.bytes}`} unit="o" />
      </div>

      {/* Boutons de panne */}
      <div className="flex flex-wrap gap-1">
        {FAULT_MODES.map((m) => (
          <button
            key={m}
            onClick={() => sendCommand("device_fault", { id: node.id, mode: m })}
            className="spring-hover px-2 py-0.5 text-[9px] rounded-full font-medium"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(235,235,245,0.55)",
            }}
          >
            {FAULT_MODE_LABEL[m]}
          </button>
        ))}
      </div>
    </div>
  )
}

function Metric({ label, val, unit }: { label: string; val: string; unit?: string }) {
  return (
    <div>
      <div className="text-[8px] uppercase tracking-wider" style={{ color: "rgba(235,235,245,0.3)" }}>{label}</div>
      <div className="text-[11px] font-mono tabular text-white/70">
        {val}{unit && <span className="text-[9px] ml-0.5" style={{ color: "rgba(235,235,245,0.3)" }}>{unit}</span>}
      </div>
    </div>
  )
}

interface Props {
  nodes: FireNode[]
  sendCommand: (type: string, payload?: Record<string, unknown>) => void
}

export function DevicesPage({ nodes, sendCommand }: Props) {
  const [filterStatus, setFilterStatus] = useState<"all" | NodeFault>("all")
  const [selected, setSelected]         = useState<string | null>(null)

  const statuses: NodeFault[] = ["ok", "batterie_faible", "figé", "aberrant", "dérive", "hors_ligne"]
  const filtered = filterStatus === "all" ? nodes : nodes.filter((n) => (n.health ?? "ok") === filterStatus)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* En-tête */}
      <div className="shrink-0 px-5 pt-4 pb-3 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="anim-down">
          <div className="text-[13px] font-semibold text-white/90" style={{ letterSpacing: "-0.374px" }}>Appareils</div>
          <div className="text-[11px] tabular mt-0.5" style={{ color: "rgba(235,235,245,0.4)" }}>
            {nodes.filter((n) => n.online).length} / {nodes.length} en ligne
          </div>
        </div>

        {/* Filtres */}
        <div className="flex items-center gap-1 anim-down anim-d2">
          <button
            onClick={() => setFilterStatus("all")}
            className="spring-hover px-2.5 py-1 text-[10px] rounded-full font-medium"
            style={{
              background: filterStatus === "all" ? "rgba(255,159,10,0.18)" : "rgba(255,255,255,0.06)",
              border: `1px solid ${filterStatus === "all" ? "rgba(255,159,10,0.3)" : "rgba(255,255,255,0.08)"}`,
              color: filterStatus === "all" ? "#ff9f0a" : "rgba(235,235,245,0.4)",
            }}
          >
            Tous <span style={{ opacity: 0.5 }}>({nodes.length})</span>
          </button>
          {statuses.map((s) => {
            const count = nodes.filter((n) => (n.health ?? "ok") === s).length
            if (count === 0) return null
            const active = filterStatus === s
            return (
              <button key={s} onClick={() => setFilterStatus(s)}
                className="spring-hover px-2 py-1 text-[10px] rounded-full font-medium flex items-center gap-1"
                style={{
                  background: active ? `${STATUS_COLOR[s]}1a` : "rgba(255,255,255,0.06)",
                  border: `1px solid ${active ? `${STATUS_COLOR[s]}35` : "rgba(255,255,255,0.08)"}`,
                  color: active ? STATUS_COLOR[s] : "rgba(235,235,245,0.4)",
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_COLOR[s] }} />
                {STATUS_LABEL[s]} {count}
              </button>
            )
          })}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-[12px]" style={{ color: "rgba(235,235,245,0.3)" }}>
            Aucun appareil.
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0" style={{ background: "rgba(18,18,20,0.90)" }}>
              <tr>
                {["ID", "Type", "État", "Batterie", "Temp.", "Fumée", ""].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-[9px] uppercase tracking-wider font-medium"
                    style={{ color: "rgba(235,235,245,0.3)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((node, i) => (
                <Fragment key={node.id}>
                  <tr
                    onClick={() => setSelected(selected === node.id ? null : node.id)}
                    className={`cursor-pointer anim-up anim-d${Math.min(i + 1, 6) as 1|2|3|4|5|6}`}
                    style={{
                      background: selected === node.id ? "rgba(255,159,10,0.07)" : "transparent",
                      opacity: node.online ? 1 : 0.45,
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      transition: "background 0.15s ease",
                    }}
                    onMouseEnter={(e) => { if (selected !== node.id) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)" }}
                    onMouseLeave={(e) => { if (selected !== node.id) (e.currentTarget as HTMLElement).style.background = "transparent" }}
                  >
                    <td className="px-3 py-2 font-mono text-[10px] text-white/60">{node.id}</td>
                    <td className="px-3 py-2 text-[10px]" style={{ color: "rgba(235,235,245,0.4)" }}>
                      {KIND_LABEL[inferKind(node.readings)]}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_COLOR[node.health ?? "ok"] }} />
                        <span className="text-[10px] font-medium" style={{ color: STATUS_COLOR[node.health ?? "ok"] }}>
                          {STATUS_LABEL[node.health ?? "ok"]}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2"><BattBar pct={node.readings?.bat} /></td>
                    <td className="px-3 py-2 font-mono text-[10px] tabular" style={{ color: "rgba(235,235,245,0.55)" }}>
                      {node.readings?.temp != null ? `${node.readings.temp.toFixed(1)}°` : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] tabular" style={{ color: "rgba(235,235,245,0.55)" }}>
                      {node.readings?.smoke != null ? `${node.readings.smoke.toFixed(0)}` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {selected === node.id
                        ? <ChevronDown className="w-3.5 h-3.5" style={{ color: "rgba(235,235,245,0.4)" }} />
                        : <ChevronRight className="w-3.5 h-3.5" style={{ color: "rgba(235,235,245,0.2)" }} />}
                    </td>
                  </tr>
                  {selected === node.id && (
                    <tr>
                      <td colSpan={7} className="p-0">
                        <DeviceDetail node={node} sendCommand={sendCommand} onClose={() => setSelected(null)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer discret */}
      <div className="shrink-0 px-5 py-2 text-[9px]" style={{ color: "rgba(235,235,245,0.2)", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <Wrench className="w-3 h-3 inline mr-1 opacity-50" />
        Cliquer une ligne pour voir les détails et contrôler les pannes
      </div>
    </div>
  )
}
