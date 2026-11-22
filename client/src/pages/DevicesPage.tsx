import { useEffect, useMemo, useState } from "react"
import { ArrowDown, ArrowUp, Search, X, MapPin, Trash2, Radio, Compass } from "lucide-react"
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts"
import type { DeviceKind, FaultMode, FireNode, NodeReadings, WorldDevice } from "@/types"
import { C, alpha, healthColor, healthLabel, kindMeta, KIND_META, rssiColor } from "@/lib/palette"
import { getReadings } from "@/lib/deviceReadings"
import { SegmentedControl } from "@/components/SegmentedControl"
import { Stepper } from "@/components/controls"

// ---------------------------------------------------------------------------
// Modèle de ligne : appareil du monde (type, panne) + dernier paquet reçu
// ---------------------------------------------------------------------------
interface DeviceRow {
  id: string
  kind: DeviceKind
  state: string            // santé affichée (pipeline serveur)
  fault: FaultMode | null  // panne injectée dans le monde (null = inconnu du monde)
  lat: number
  lon: number
  azimuth: number
  node?: FireNode
  gw: string | null
  rssi?: number
  snr?: number
  bat?: number
  temp?: number
  smoke?: number
  ts?: number
  bytes?: number
}

function inferKind(r: NodeReadings): DeviceKind {
  if (r.tmax != null) return "thermal"
  if (r.rx != null) return "gateway"
  if (r.on != null) return "siren"
  if (r.wind_speed != null && r.smoke == null && r.temp == null) return "wind"
  if (r.flame != null && r.smoke == null && r.temp == null) return "flame"
  if (r.co != null && r.smoke == null && r.temp == null) return "co"
  if (r.smoke != null && r.temp == null) return "smoke"
  if (r.fmc != null && r.temp == null) return "fuel"
  if (r.rain != null && r.temp == null) return "rain"
  if (r.temp != null && r.smoke == null) return "temp"
  return "station"
}

function buildRows(devices: WorldDevice[], nodes: FireNode[]): DeviceRow[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const rows: DeviceRow[] = []
  const seen = new Set<string>()
  const make = (id: string, kind: DeviceKind, lat: number, lon: number, azimuth: number, fault: FaultMode | null, node?: FireNode): DeviceRow => ({
    id, kind, lat, lon, azimuth, fault, node,
    // sans paquet reçu, l'appareil n'est pas (encore) vu par le serveur
    state: node ? (node.online ? (node.health ?? "ok") : "hors_ligne") : "hors_ligne",
    gw: node?.gw ?? null,
    rssi: node?.readings?.rssi,
    snr: node?.readings?.snr,
    bat: node?.readings?.bat,
    temp: node?.readings?.temp,
    smoke: node?.readings?.smoke,
    ts: node?.ts,
    bytes: node?.bytes,
  })
  for (const d of devices) {
    seen.add(d.id)
    rows.push(make(d.id, d.kind, d.lat, d.lon, d.azimuth ?? 0, d.fault, byId.get(d.id)))
  }
  for (const n of nodes) {
    if (!seen.has(n.id)) rows.push(make(n.id, inferKind(n.readings ?? {}), n.lat, n.lon, 0, null, n))
  }
  return rows
}

// ---------------------------------------------------------------------------
// Colonnes
// ---------------------------------------------------------------------------
type SortKey = "kind" | "id" | "state" | "gw" | "rssi" | "snr" | "bat" | "temp" | "smoke" | "ts" | "bytes"

const COLUMNS: { key: SortKey; label: string; width: number; align: "left" | "right" }[] = [
  { key: "kind",  label: "Type",            width: 210, align: "left" },
  { key: "id",    label: "ID",              width: 72,  align: "left" },
  { key: "state", label: "État",            width: 132, align: "left" },
  { key: "gw",    label: "Passerelle",      width: 96,  align: "left" },
  { key: "rssi",  label: "RSSI (dBm)",      width: 96,  align: "right" },
  { key: "snr",   label: "SNR (dB)",        width: 84,  align: "right" },
  { key: "bat",   label: "Batterie",        width: 128, align: "left" },
  { key: "temp",  label: "Temp (°C)",       width: 88,  align: "right" },
  { key: "smoke", label: "Fumée (ppm)",     width: 100, align: "right" },
  { key: "ts",    label: "Dernière mesure", width: 128, align: "right" },
  { key: "bytes", label: "Paquet (o CBOR)", width: 120, align: "right" },
]

const STATE_GROUPS: { value: StateFilter; label: string; dot?: string }[] = [
  { value: "all", label: "Tous" },
  { value: "ok", label: "OK", dot: C.ok },
  { value: "batterie_faible", label: "Batterie", dot: C.low },
  { value: "panne", label: "En panne", dot: C.fire },
  { value: "hors_ligne", label: "Hors ligne", dot: C.gray },
]
type StateFilter = "all" | "ok" | "batterie_faible" | "panne" | "hors_ligne"

const matchState = (row: DeviceRow, f: StateFilter) =>
  f === "all" ? true
  : f === "panne" ? ["figé", "dérive", "aberrant"].includes(row.state)
  : row.state === f

function sortValue(r: DeviceRow, k: SortKey): string | number {
  switch (k) {
    case "kind": return kindMeta(r.kind).label
    case "id": return r.id
    case "state": return healthLabel(r.state)
    case "gw": return r.gw ?? "~"
    case "ts": return r.ts ?? 0
    default: {
      const v = r[k]
      return typeof v === "number" ? v : -Infinity
    }
  }
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}

function ago(ts: number | undefined, now: number): string {
  if (!ts) return "—"
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return `il y a ${s} s`
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`
  return `il y a ${Math.floor(s / 3600)} h`
}

const num = (v: number | undefined, d = 0) => (v === undefined || v === null || !Number.isFinite(v) ? "—" : v.toFixed(d))

function BatteryBar({ pct }: { pct?: number }) {
  if (pct === undefined) return <span style={{ color: C.text4 }}>—</span>
  const low = pct < 15
  return (
    <div className="flex items-center gap-2">
      <div className="h-[3px] rounded-full overflow-hidden flex-1 max-w-[64px]" style={{ background: C.gray }}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: low ? C.red : C.fire, transition: "width 0.4s ease" }} />
      </div>
      <span className="text-[11px] tabular w-10 text-right" style={{ color: low ? C.red : C.text2 }}>{pct.toFixed(0)} %</span>
    </div>
  )
}

function StatePill({ state }: { state: string }) {
  const color = healthColor(state)
  const neutral = color === C.gray
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full text-[11px] font-medium whitespace-nowrap"
      style={{ background: neutral ? "rgba(255,255,255,0.06)" : alpha(color, 0.12), color: neutral ? C.text3 : C.text }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {healthLabel(state)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Tiroir de détail
// ---------------------------------------------------------------------------
const FAULT_MODES: { mode: FaultMode; label: string }[] = [
  { mode: "ok", label: "Normal" },
  { mode: "offline", label: "Hors ligne" },
  { mode: "battery", label: "Batterie" },
  { mode: "stuck", label: "Figé" },
  { mode: "drift", label: "Dérive" },
  { mode: "spike", label: "Pics" },
  { mode: "noisy", label: "Bruit" },
]

interface HistPoint { t: number; temp?: number; smoke?: number; co?: number; rssi?: number; tmax?: number }

const tooltipStyle = {
  contentStyle: { background: "#0d0d0d", border: `1px solid ${C.line}`, borderRadius: 10, fontSize: 11 },
  labelStyle: { color: C.text3 },
}

function MiniChart({ data, dataKey, color, unit, label }: { data: HistPoint[]; dataKey: keyof HistPoint; color: string; unit: string; label: string }) {
  const has = data.some((d) => d[dataKey] !== undefined && d[dataKey] !== null)
  if (!has) return null
  return (
    <div>
      <div className="text-[10px] mb-1" style={{ color: C.text3 }}>{label} <span style={{ color: C.text4 }}>({unit})</span></div>
      <div className="h-[86px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis dataKey="t" hide />
            <YAxis tick={{ fill: C.text4, fontSize: 9 }} axisLine={false} tickLine={false} width={44} domain={["auto", "auto"]} />
            <Tooltip {...tooltipStyle}
              labelFormatter={(v) => new Date(Number(v)).toLocaleTimeString("fr-FR")}
              formatter={(v) => [`${Number(v).toFixed(1)} ${unit}`, label]} />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function hexLines(hex: string) {
  const bytes = hex.match(/.{1,2}/g) ?? []
  const lines: string[] = []
  for (let i = 0; i < bytes.length; i += 16) lines.push(bytes.slice(i, i + 16).join(" "))
  return lines
}

const SECTION = "text-[10px] uppercase font-semibold"
const SECTION_STYLE = { color: C.text4, letterSpacing: "0.09em" }

function DeviceDrawer({ row, onClose, onLocate, sendCommand }: {
  row: DeviceRow
  onClose: () => void
  onLocate: (lat: number, lon: number) => void
  sendCommand: (type: string, payload?: Record<string, unknown>) => void
}) {
  const meta = kindMeta(row.kind)
  const node = row.node
  const readings = node ? getReadings(row.kind, node.readings ?? {}) : []
  const pkt = node?.lastPacket
  const [hist, setHist] = useState<HistPoint[]>([])
  const now = useNow(1000)

  useEffect(() => {
    let alive = true
    const load = () => fetch(`/api/history/${encodeURIComponent(row.id)}`)
      .then((r) => r.json())
      .then((list: Record<string, unknown>[]) => {
        if (!alive) return
        setHist(list.map((m) => ({
          t: new Date(m.ts as string).getTime(),
          temp: m.temp as number | undefined, smoke: m.smoke as number | undefined,
          co: m.co as number | undefined, rssi: m.rssi as number | undefined, tmax: m.tmax as number | undefined,
        })))
      })
      .catch(() => {})
    load()
    const id = window.setInterval(load, 5000)
    return () => { alive = false; window.clearInterval(id) }
  }, [row.id])

  const savings = pkt && pkt.jsonBytes > 0 ? Math.round((1 - pkt.cborBytes / pkt.jsonBytes) * 100) : null

  return (
    <aside
      className="absolute top-0 right-0 bottom-0 z-10 flex flex-col anim-right"
      style={{
        width: "min(440px, 100%)",
        background: "#0a0a0a",
        borderLeft: `1px solid ${C.line}`,
        boxShadow: "-12px 0 40px rgba(0,0,0,0.45)",
      }}
      aria-label={`Détail de ${row.id}`}
    >
      {/* En-tête */}
      <div className="shrink-0 flex items-center gap-3 px-5 pt-4 pb-3.5" style={{ borderBottom: `1px solid ${C.line}` }}>
        <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.07)" }}>
          <meta.Icon className="w-5 h-5" style={{ color: C.text }} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold font-mono" style={{ color: C.text }}>{row.id}</span>
            <StatePill state={row.state} />
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: C.text3 }}>{meta.label} · {meta.model}</div>
        </div>
        <button onClick={onClose} aria-label="Fermer" className="w-8 h-8 flex items-center justify-center rounded-full spring-hover" style={{ background: C.fill, color: C.text2 }}>
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 fw-scroll px-5 py-4 flex flex-col gap-5">
        <button
          onClick={() => onLocate(row.lat, row.lon)}
          className="h-9 shrink-0 rounded-full text-[12px] font-semibold flex items-center justify-center gap-2 spring-hover"
          style={{ background: C.fire, color: "#000" }}
        >
          <MapPin className="w-4 h-4" /> Voir sur la carte
        </button>

        {/* Mesures */}
        <section>
          <h3 className={`${SECTION} mb-2`} style={SECTION_STYLE}>Mesures</h3>
          {readings.length ? (
            <div className="grid grid-cols-3 gap-2">
              {readings.map((m) => (
                <div key={m.label} className="px-3 py-2 rounded-xl" style={{ background: C.fill }}>
                  <div className="text-[10px]" style={{ color: C.text3 }}>{m.label}</div>
                  <div className="text-[15px] font-semibold tabular" style={{ color: C.text }}>
                    {m.value}<span className="text-[10px] font-normal ml-0.5" style={{ color: C.text3 }}>{m.unit}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="text-[12px]" style={{ color: C.text4 }}>Aucun paquet reçu de cet appareil.</div>}
          <div className="text-[10px] mt-2" style={{ color: C.text4 }}>Dernière mesure {ago(row.ts, now)}</div>
        </section>

        {/* Radio */}
        <section>
          <h3 className={`${SECTION} mb-2 flex items-center gap-1.5`} style={SECTION_STYLE}>
            <Radio className="w-3 h-3" /> Liaison LoRaWAN
          </h3>
          <div className="grid grid-cols-4 gap-2">
            {[
              { l: "Passerelle", v: row.gw === row.id ? "Filaire" : row.gw ?? "—" },
              { l: "RSSI", v: `${num(row.rssi)} dBm` },
              { l: "SNR", v: `${num(row.snr, 1)} dB` },
              { l: "SF", v: node?.sf ? `SF${node.sf}` : "—" },
              { l: "Séquence", v: node?.seq !== undefined ? `#${node.seq}` : "—" },
              { l: "Période", v: node ? `${node.period} s` : "—" },
              { l: "Batterie", v: `${num(row.bat)} %` },
              { l: "Position", v: `${row.lat.toFixed(3)}, ${row.lon.toFixed(3)}` },
            ].map((x) => (
              <div key={x.l} className="px-2.5 py-1.5 rounded-lg min-w-0" style={{ background: C.fill }}>
                <div className="text-[9px]" style={{ color: C.text4 }}>{x.l}</div>
                <div className="text-[11px] font-medium tabular truncate" style={{ color: C.text }}>{x.v}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Graphiques */}
        {hist.length > 1 && (
          <section className="flex flex-col gap-3">
            <h3 className={SECTION} style={SECTION_STYLE}>Historique ({hist.length} mesures)</h3>
            <MiniChart data={hist} dataKey="smoke" color={C.fire} unit="ppm" label="Fumée" />
            <MiniChart data={hist} dataKey="temp" color="#ffffff" unit="°C" label="Température" />
            <MiniChart data={hist} dataKey="tmax" color={C.red} unit="°C" label="T. max thermique" />
            <MiniChart data={hist} dataKey="rssi" color={C.text3} unit="dBm" label="RSSI" />
          </section>
        )}

        {/* Paquet SenML / CBOR */}
        {pkt && (
          <section>
            <div className="flex items-baseline justify-between mb-2 gap-2">
              <h3 className={SECTION} style={SECTION_STYLE}>Dernier paquet SenML</h3>
              <span className="text-[11px] tabular whitespace-nowrap" style={{ color: C.text2 }}>
                <b style={{ color: C.text }}>{pkt.cborBytes} o</b> CBOR · {pkt.jsonBytes} o JSON
                {savings !== null && <span style={{ color: C.fire }}> · −{savings} %</span>}
              </span>
            </div>
            <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
              <table className="w-full text-[11px]">
                <thead>
                  <tr style={{ background: C.fill }}>
                    {["n", "u", "valeur"].map((h) => (
                      <th key={h} className="text-left font-medium px-3 py-1.5" style={{ color: C.text4 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pkt.senml.map((r, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${C.line}` }}>
                      <td className="px-3 py-1 font-mono" style={{ color: C.text }}>{r.n}</td>
                      <td className="px-3 py-1 font-mono" style={{ color: C.text3 }}>{r.u ?? ""}</td>
                      <td className="px-3 py-1 font-mono tabular" style={{ color: C.text2 }}>
                        {r.v ?? (r.vb !== undefined ? String(r.vb) : r.vs ?? "")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[10px] mt-1.5 font-mono truncate" style={{ color: C.text4 }}>bn = {pkt.senml[0]?.bn} · bt = {pkt.senml[0]?.bt}</div>
            <div className={`mt-3 mb-1.5 ${SECTION}`} style={SECTION_STYLE}>Hexadécimal CBOR</div>
            <pre className="text-[10px] leading-[1.55] font-mono p-3 rounded-xl overflow-x-auto" style={{ background: "rgba(0,0,0,0.5)", color: C.text2, border: `1px solid ${C.line}` }}>
              {hexLines(pkt.hex).map((l, i) => (
                <div key={i}><span style={{ color: C.text4 }}>{(i * 16).toString(16).padStart(4, "0")}  </span>{l}</div>
              ))}
            </pre>
          </section>
        )}

        {/* Orientation caméra */}
        {row.kind === "thermal" && row.fault !== null && (
          <section className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[12px]" style={{ color: C.text2 }}>
              <Compass className="w-4 h-4" style={{ color: C.fire }} /> Azimut de la caméra
            </div>
            <Stepper label="Azimut" value={Math.round(row.azimuth)} min={0} max={355} step={5} unit="°"
              onChange={(v) => sendCommand("device_rotate", { id: row.id, azimuth: v })} />
          </section>
        )}

        {/* Pannes */}
        {row.fault !== null && (
          <section>
            <h3 className={`${SECTION} mb-2`} style={SECTION_STYLE}>Injecter une panne</h3>
            <div className="flex flex-wrap gap-1.5">
              {FAULT_MODES.map(({ mode, label }) => {
                const active = row.fault === mode
                const tone = mode === "ok" ? "#ffffff" : C.fire
                return (
                  <button
                    key={mode}
                    onClick={() => sendCommand("device_fault", { id: row.id, mode })}
                    className="h-7 px-3 rounded-full text-[11px] font-medium spring-hover"
                    style={{
                      background: active ? alpha(tone, mode === "ok" ? 0.14 : 0.18) : C.fill,
                      border: `1px solid ${active ? alpha(tone, 0.45) : C.line}`,
                      color: active ? (mode === "ok" ? C.text : C.fire) : C.text2,
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <button
              onClick={() => { sendCommand("device_remove", { id: row.id }); onClose() }}
              className="mt-3 h-8 px-3 rounded-full text-[11px] font-medium flex items-center gap-1.5 spring-hover"
              style={{ background: "transparent", border: `1px solid ${alpha(C.red, 0.4)}`, color: C.red }}
            >
              <Trash2 className="w-3.5 h-3.5" /> Retirer l'appareil
            </button>
          </section>
        )}
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
interface Props {
  nodes: FireNode[]
  devices: WorldDevice[]
  sendCommand: (type: string, payload?: Record<string, unknown>) => void
  onLocate: (lat: number, lon: number) => void
}

export function DevicesPage({ nodes, devices, sendCommand, onLocate }: Props) {
  const [query, setQuery] = useState("")
  const [stateFilter, setStateFilter] = useState<StateFilter>("all")
  const [kindFilter, setKindFilter] = useState<string>("all")
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "id", dir: 1 })
  const [selected, setSelected] = useState<string | null>(null)
  const now = useNow(1000)

  const rows = useMemo(() => buildRows(devices, nodes), [devices, nodes])

  const kindsPresent = useMemo(() => {
    const counts = new Map<DeviceKind, number>()
    rows.forEach((r) => counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1))
    return (Object.keys(KIND_META) as DeviceKind[])
      .filter((k) => counts.has(k))
      .map((k) => ({ value: k as string, label: KIND_META[k].label, count: counts.get(k) }))
  }, [rows])

  const stateCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const g of STATE_GROUPS) c[g.value] = rows.filter((r) => matchState(r, g.value)).length
    return c
  }, [rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = rows.filter((r) =>
      matchState(r, stateFilter) &&
      (kindFilter === "all" || r.kind === kindFilter) &&
      (!q || r.id.toLowerCase().includes(q) || kindMeta(r.kind).label.toLowerCase().includes(q) || (r.gw ?? "").toLowerCase().includes(q)))
    return list.sort((a, b) => {
      const va = sortValue(a, sort.key), vb = sortValue(b, sort.key)
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "fr", { numeric: true })
      return cmp * sort.dir || a.id.localeCompare(b.id, "fr", { numeric: true })
    })
  }, [rows, query, stateFilter, kindFilter, sort])

  const selectedRow = rows.find((r) => r.id === selected) ?? null
  const online = rows.filter((r) => r.state !== "hors_ligne").length
  const minWidth = COLUMNS.reduce((s, c) => s + c.width, 0)

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "ts" ? -1 : 1 }))

  return (
    <div className="relative flex flex-col h-full min-h-0">
      {/* En-tête */}
      <div className="shrink-0 pt-5 pb-4" style={{ borderBottom: `1px solid ${C.line}` }}>
        <div className="mx-auto w-full max-w-[1440px] px-6 flex flex-col gap-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[18px] font-semibold" style={{ color: C.text, letterSpacing: "-0.4px" }}>Appareils</h1>
            <p className="text-[12px] mt-0.5 tabular" style={{ color: C.text3 }}>
              {online} / {rows.length} en ligne · {filtered.length} affiché{filtered.length > 1 ? "s" : ""}
            </p>
          </div>
          <label className="flex items-center gap-2 h-8 px-3 rounded-full w-[280px]" style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${C.line}` }}>
            <Search className="w-3.5 h-3.5 shrink-0" style={{ color: C.text3 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher (ID, type, passerelle)"
              aria-label="Rechercher un appareil"
              className="bg-transparent outline-none text-[12px] flex-1 min-w-0"
              style={{ color: C.text }}
            />
            {query && <button onClick={() => setQuery("")} aria-label="Effacer la recherche"><X className="w-3.5 h-3.5" style={{ color: C.text3 }} /></button>}
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            compact
            options={STATE_GROUPS.map((g) => ({ value: g.value, label: g.label, dot: g.dot, count: stateCounts[g.value] }))}
            value={stateFilter}
            onChange={setStateFilter}
          />
          <SegmentedControl
            compact
            options={[{ value: "all", label: "Tous types", count: rows.length }, ...kindsPresent]}
            value={kindFilter}
            onChange={setKindFilter}
          />
        </div>
        </div>
      </div>

      {/* Tableau */}
      <div className="flex-1 min-h-0 fw-scroll overflow-x-auto">
        <div className="mx-auto w-full max-w-[1440px] px-3">
        <table className="w-full table-fixed border-separate border-spacing-0" style={{ minWidth }}>
          <colgroup>{COLUMNS.map((c) => <col key={c.key} style={{ width: c.width }} />)}</colgroup>
          <thead className="sticky top-0 z-[1]">
            <tr>
              {COLUMNS.map((c) => {
                const active = sort.key === c.key
                return (
                  <th key={c.key} scope="col"
                    className={`px-3 py-2.5 text-[10px] font-semibold uppercase select-none ${c.align === "right" ? "text-right" : "text-left"}`}
                    style={{ color: active ? C.text : C.text4, letterSpacing: "0.06em", background: "rgba(12,12,12,0.97)", borderBottom: `1px solid ${C.line}` }}
                    aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                    <button onClick={() => onSort(c.key)} className={`inline-flex items-center gap-1 ${c.align === "right" ? "flex-row-reverse" : ""}`}>
                      {c.label}
                      {active && (sort.dir === 1
                        ? <ArrowUp className="w-3 h-3" style={{ color: C.fire }} />
                        : <ArrowDown className="w-3 h-3" style={{ color: C.fire }} />)}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const meta = kindMeta(r.kind)
              const isSel = r.id === selected
              const dim = r.state === "hors_ligne"
              const td = "px-3 py-2 text-[12px] whitespace-nowrap overflow-hidden text-ellipsis"
              const tdNum = `${td} text-right tabular`
              const b = { borderBottom: `1px solid ${C.line}` }
              return (
                <tr
                  key={r.id}
                  onClick={() => setSelected(isSel ? null : r.id)}
                  className="cursor-pointer"
                  style={{ background: isSel ? alpha(C.fire, 0.09) : undefined, opacity: dim ? 0.55 : 1 }}
                  onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = "rgba(255,255,255,0.03)" }}
                  onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = "" }}
                >
                  <td className={td} style={b}>
                    <span className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.06)" }}>
                        <meta.Icon className="w-3.5 h-3.5" style={{ color: C.text2 }} />
                      </span>
                      <span style={{ color: C.text }}>{meta.label}</span>
                      <span className="text-[11px] truncate" style={{ color: C.text4 }}>{meta.model}</span>
                    </span>
                  </td>
                  <td className={`${td} font-mono`} style={{ ...b, color: C.text }}>{r.id}</td>
                  <td className={td} style={b}><StatePill state={r.state} /></td>
                  <td className={`${td} font-mono`} style={{ ...b, color: r.gw ? C.text2 : C.text4 }}>{r.gw === r.id ? "Filaire" : r.gw ?? "—"}</td>
                  <td className={tdNum} style={{ ...b, color: r.rssi !== undefined ? C.text2 : C.text4 }}>
                    {r.rssi !== undefined && <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ background: rssiColor(r.rssi) }} />}
                    {num(r.rssi)}
                  </td>
                  <td className={tdNum} style={{ ...b, color: C.text2 }}>{num(r.snr, 1)}</td>
                  <td className={td} style={b}><BatteryBar pct={r.bat} /></td>
                  <td className={tdNum} style={{ ...b, color: C.text2 }}>{num(r.temp, 1)}</td>
                  <td className={tdNum} style={{ ...b, color: (r.smoke ?? 0) > 300 ? C.fire : C.text2 }}>{num(r.smoke)}</td>
                  <td className={tdNum} style={{ ...b, color: C.text3 }}>{ago(r.ts, now)}</td>
                  <td className={tdNum} style={{ ...b, color: C.text2 }}>{r.bytes ?? "—"}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-32 text-[12px]" style={{ color: C.text4 }}>Aucun appareil ne correspond aux filtres.</div>
        )}
        </div>
      </div>

      {selectedRow && (
        <DeviceDrawer
          key={selectedRow.id}
          row={selectedRow}
          onClose={() => setSelected(null)}
          onLocate={onLocate}
          sendCommand={sendCommand}
        />
      )}
    </div>
  )
}
