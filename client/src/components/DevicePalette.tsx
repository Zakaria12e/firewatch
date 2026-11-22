import { Flame, Droplets } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { DeviceKind } from "@/types"
import { C, alpha, KIND_META } from "@/lib/palette"
import { SegmentedControl } from "./SegmentedControl"

interface PaletteItem {
  kind: DeviceKind | "__fire__" | "__water__"
  label: string
  model: string
  tooltip: string
  Icon: LucideIcon
  accent?: string
}

const TOOLTIPS: Record<DeviceKind, string> = {
  station: "Station ESP32 + LoRa – mesures complètes",
  temp: "Capteur DHT22 – température + humidité",
  smoke: "Capteur MQ-2 – fumée en ppm",
  co: "Capteur MQ-7 – monoxyde de carbone",
  flame: "Capteur KY-026 IR – détecte une flamme à moins de 100 m",
  thermal: "Caméra MLX90640 – cône 110°, portée 800 m",
  wind: "Anémomètre + girouette – vitesse et direction",
  fuel: "Sonde FMC – humidité des végétaux morts",
  rain: "Pluviomètre – précipitations mm/h",
  siren: "Sirène + relais – commandée par CoAP",
  gateway: "Passerelle LoRaWAN – couverture 3-5 km",
}

const SHORT: Partial<Record<DeviceKind, string>> = { temp: "Temp.", fuel: "Fuel", gateway: "Passerelle" }

const DEVICES: PaletteItem[] = (Object.keys(KIND_META) as DeviceKind[]).map((k) => ({
  kind: k,
  label: SHORT[k] ?? KIND_META[k].label,
  model: KIND_META[k].model,
  tooltip: TOOLTIPS[k],
  Icon: KIND_META[k].Icon,
}))

const TOOLS: PaletteItem[] = [
  { kind: "__fire__",  label: "Feu",      model: "Allumer",     tooltip: "Glisser sur la carte pour démarrer un feu", Icon: Flame,    accent: C.fire },
  { kind: "__water__", label: "Canadair", model: "Larguer eau", tooltip: "Larguer de l'eau – éteint les cellules proches", Icon: Droplets },
]

function DeviceCard({ item }: { item: PaletteItem }) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("kind", item.kind)
    e.dataTransfer.effectAllowed = "copy"
  }
  const accent = item.accent ?? "#ffffff"
  return (
    <div
      draggable
      onDragStart={handleDragStart}
      title={item.tooltip}
      className="spring-hover flex flex-col items-center gap-1.5 p-2 rounded-xl cursor-grab active:cursor-grabbing select-none"
      style={{ background: C.fill, border: `1px solid ${item.accent ? alpha(item.accent, 0.3) : "rgba(255,255,255,0.06)"}` }}
    >
      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
        style={{ background: item.accent ? alpha(item.accent, 0.16) : "rgba(255,255,255,0.07)" }}>
        <item.Icon className="w-4 h-4" style={{ color: item.accent ? accent : C.text }} />
      </div>
      <div className="text-center leading-none">
        <div className="text-[10px] font-medium" style={{ color: C.text }}>{item.label}</div>
        <div className="text-[8px] mt-0.5 font-mono" style={{ color: C.text4 }}>{item.model}</div>
      </div>
    </div>
  )
}

const WEATHER_OPTIONS = [
  { value: "reel",      label: "Réel" },
  { value: "manuel",    label: "Manuel" },
  { value: "prevision", label: "Prévis." },
]

const PRESETS = [
  { name: "chergui", label: "Chergui" },
  { name: "normal",  label: "Normal" },
  { name: "pluie",   label: "Pluie" },
  { name: "nuit",    label: "Nuit" },
]

function WeatherPanel({ weatherMode, onModeChange, onPreset }: {
  weatherMode: string
  onModeChange: (mode: string) => void
  onPreset: (name: string) => void
}) {
  return (
    <div className="px-1 pb-1">
      <p className="text-[9px] uppercase px-1 py-1.5 font-medium" style={{ color: C.text4, letterSpacing: "0.1em" }}>Météo</p>
      <SegmentedControl options={WEATHER_OPTIONS} value={weatherMode} onChange={onModeChange} className="mb-2" />
      {weatherMode === "manuel" && (
        <div className="grid grid-cols-2 gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => onPreset(p.name)}
              className="py-1.5 text-[10px] rounded-lg font-medium spring-hover"
              style={{ background: C.fill, border: `1px solid ${C.line}`, color: p.name === "chergui" ? C.fire : C.text2 }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface Props {
  weatherMode?: string
  onWeatherModeChange?: (mode: string) => void
  onWeatherPreset?: (name: string) => void
}

export function DevicePalette({ weatherMode = "reel", onWeatherModeChange, onWeatherPreset }: Props) {
  return (
    <div
      className="glass anim-left fixed top-16 bottom-3 z-30 flex flex-col overflow-hidden"
      style={{ left: "var(--dock-space)", width: 190, borderRadius: 18 }}
    >
      <div className="px-2.5 pt-3 pb-1 shrink-0">
        <p className="text-[9px] uppercase font-medium mb-2" style={{ color: C.text4, letterSpacing: "0.1em" }}>Appareils</p>
        <div className="grid grid-cols-2 gap-1.5">
          {DEVICES.map((item) => <DeviceCard key={item.kind} item={item} />)}
        </div>
      </div>

      <div className="mx-3 my-1 h-px shrink-0" style={{ background: C.line }} />

      <div className="px-2.5 pb-1 shrink-0">
        <p className="text-[9px] uppercase font-medium mb-2" style={{ color: C.text4, letterSpacing: "0.1em" }}>Outils</p>
        <div className="grid grid-cols-2 gap-1.5">
          {TOOLS.map((item) => <DeviceCard key={item.kind} item={item} />)}
        </div>
      </div>

      <div className="mx-3 my-1 h-px shrink-0" style={{ background: C.line }} />

      <div className="flex-1 fw-scroll px-1.5">
        <WeatherPanel
          weatherMode={weatherMode}
          onModeChange={onWeatherModeChange ?? (() => {})}
          onPreset={onWeatherPreset ?? (() => {})}
        />
      </div>
    </div>
  )
}
