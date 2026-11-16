import {
  Cpu, Thermometer, CloudFog, TriangleAlert, Flame, Camera,
  Wind, Leaf, CloudRain, Bell, Radio, Droplets,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { DeviceKind } from "@/types"
import { SegmentedControl } from "./SegmentedControl"

interface PaletteItem {
  kind: DeviceKind | "__fire__" | "__water__"
  label: string
  model: string
  tooltip: string
  Icon: LucideIcon
  color: string
}

const DEVICES: PaletteItem[] = [
  { kind: "station",  label: "Station",   model: "ESP32+LoRa",   tooltip: "Station ESP32+LoRa – mesures complètes",          Icon: Cpu,           color: "#0a84ff" },
  { kind: "temp",     label: "Temp.",     model: "DHT22",        tooltip: "Capteur DHT22 – température + humidité",          Icon: Thermometer,   color: "#ff9f0a" },
  { kind: "smoke",    label: "Fumée",     model: "MQ-2",         tooltip: "Capteur MQ-2 – fumée en ppm",                    Icon: CloudFog,      color: "#bf5af2" },
  { kind: "co",       label: "CO",        model: "MQ-7",         tooltip: "Capteur MQ-7 – monoxyde de carbone",             Icon: TriangleAlert, color: "#ffd60a" },
  { kind: "flame",    label: "Flamme",    model: "KY-026",       tooltip: "Capteur KY-026 IR – détecte une flamme à <100 m", Icon: Flame,         color: "#ff3b30" },
  { kind: "thermal",  label: "Thermique", model: "MLX90640",     tooltip: "Caméra MLX90640 – cône 110°, portée 800 m",       Icon: Camera,        color: "#64d2ff" },
  { kind: "wind",     label: "Vent",      model: "Anémomètre",   tooltip: "Anémomètre + girouette – vitesse et direction",   Icon: Wind,          color: "#8e8e93" },
  { kind: "fuel",     label: "Fuel",      model: "Sonde FMC",    tooltip: "Sonde FMC – humidité des végétaux morts",         Icon: Leaf,          color: "#30d158" },
  { kind: "rain",     label: "Pluie",     model: "Pluviomètre",  tooltip: "Pluviomètre – précipitations mm/h",               Icon: CloudRain,     color: "#5ac8fa" },
  { kind: "siren",    label: "Sirène",    model: "Sirène+Relais", tooltip: "Sirène + relais – commandée par CoAP",           Icon: Bell,          color: "#ff375f" },
  { kind: "gateway",  label: "Gateway",   model: "LoRaWAN GW",   tooltip: "Passerelle LoRaWAN – couverture 3-5 km",          Icon: Radio,         color: "#34c759" },
]

const TOOLS: PaletteItem[] = [
  { kind: "__fire__",  label: "Feu",      model: "Allumer",      tooltip: "Glisser sur la carte pour démarrer un feu",       Icon: Flame,    color: "#ff3b30" },
  { kind: "__water__", label: "Canadair", model: "Larguer eau",  tooltip: "Larguer de l'eau – éteint les cellules proches",   Icon: Droplets, color: "#0a84ff" },
]

function DeviceCard({ item }: { item: PaletteItem }) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("kind", item.kind)
    e.dataTransfer.effectAllowed = "copy"
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      title={item.tooltip}
      className="spring-hover flex flex-col items-center gap-1.5 p-2 rounded-xl cursor-grab active:cursor-grabbing select-none"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
        style={{ background: `${item.color}1f` }}
      >
        <item.Icon className="w-4 h-4" style={{ color: item.color }} />
      </div>
      <div className="text-center leading-none">
        <div className="text-[10px] font-medium text-white/80">{item.label}</div>
        <div className="text-[8px] text-white/30 mt-0.5 font-mono">{item.model}</div>
      </div>
    </div>
  )
}

interface WeatherPanelProps {
  weatherMode: string
  onModeChange: (mode: string) => void
  onPreset: (name: string) => void
}

function WeatherPanel({ weatherMode, onModeChange, onPreset }: WeatherPanelProps) {
  const WEATHER_OPTIONS = [
    { value: "reel",      label: "Réel" },
    { value: "manuel",    label: "Manuel" },
    { value: "prevision", label: "Prévis." },
  ] as const

  return (
    <div className="px-1 pb-1">
      <p className="text-[9px] text-white/30 uppercase tracking-widest px-1 py-1.5 font-medium" style={{ letterSpacing: "0.1em" }}>
        Météo
      </p>

      <SegmentedControl
        options={WEATHER_OPTIONS as unknown as { value: string; label: string }[]}
        value={weatherMode}
        onChange={onModeChange}
        className="mb-2"
      />

      {weatherMode === "manuel" && (
        <div className="grid grid-cols-2 gap-1">
          {[
            { name: "chergui", label: "Chergui", color: "#ff3b30" },
            { name: "normal",  label: "Normal",  color: "#30d158" },
            { name: "pluie",   label: "Pluie",   color: "#0a84ff" },
            { name: "nuit",    label: "Nuit",    color: "#bf5af2" },
          ].map((p) => (
            <button
              key={p.name}
              onClick={() => onPreset(p.name)}
              className="py-1.5 text-[10px] rounded-lg font-medium transition-all"
              style={{
                background: `${p.color}14`,
                border: `1px solid ${p.color}2a`,
                color: `${p.color}`,
              }}
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
      style={{ left: 72, width: 190, borderRadius: 18 }}
    >
      {/* Appareils */}
      <div className="px-2.5 pt-3 pb-1 shrink-0">
        <p className="text-[9px] text-white/30 uppercase tracking-widest font-medium mb-2" style={{ letterSpacing: "0.1em" }}>
          Appareils
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {DEVICES.map((item) => (
            <DeviceCard key={item.kind} item={item} />
          ))}
        </div>
      </div>

      {/* Séparateur */}
      <div className="mx-3 my-1 h-px bg-white/8 shrink-0" />

      {/* Outils */}
      <div className="px-2.5 pb-1 shrink-0">
        <p className="text-[9px] text-white/30 uppercase tracking-widest font-medium mb-2" style={{ letterSpacing: "0.1em" }}>
          Outils
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {TOOLS.map((item) => (
            <DeviceCard key={item.kind} item={item} />
          ))}
        </div>
      </div>

      {/* Séparateur */}
      <div className="mx-3 my-1 h-px bg-white/8 shrink-0" />

      {/* Météo */}
      <div className="flex-1 overflow-y-auto px-1.5">
        <WeatherPanel
          weatherMode={weatherMode}
          onModeChange={onWeatherModeChange ?? (() => {})}
          onPreset={onWeatherPreset ?? (() => {})}
        />
      </div>
    </div>
  )
}
