import {
  Cpu, Thermometer, CloudFog, TriangleAlert, Flame, Camera,
  Wind, Leaf, CloudRain, Bell, Radio, Droplets,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { DeviceKind } from "@/types"

interface PaletteItem {
  kind: DeviceKind | "__fire__" | "__water__"
  label: string
  tooltip: string
  Icon: LucideIcon
  color: string
}

const DEVICES: PaletteItem[] = [
  { kind: "station",  label: "Station",     tooltip: "Station ESP32+LoRa – mesures complètes",          Icon: Cpu,           color: "#3b82f6" },
  { kind: "temp",     label: "Température", tooltip: "Capteur DHT22 – température + humidité",          Icon: Thermometer,   color: "#f97316" },
  { kind: "smoke",    label: "Fumée",       tooltip: "Capteur MQ-2 – fumée en ppm (sensible à l'HR)",   Icon: CloudFog,      color: "#a78bfa" },
  { kind: "co",       label: "CO",          tooltip: "Capteur MQ-7 – monoxyde de carbone",              Icon: TriangleAlert, color: "#eab308" },
  { kind: "flame",    label: "Flamme",      tooltip: "Capteur KY-026 IR – détecte une flamme à <100 m", Icon: Flame,         color: "#ef4444" },
  { kind: "thermal",  label: "Thermique",   tooltip: "Caméra MLX90640 – cône 110°, portée 800 m",       Icon: Camera,        color: "#06b6d4" },
  { kind: "wind",     label: "Vent",        tooltip: "Anémomètre + girouette – vitesse et direction",   Icon: Wind,          color: "#a3a3a3" },
  { kind: "fuel",     label: "Fuel",        tooltip: "Sonde FMC – humidité des végétaux morts",         Icon: Leaf,          color: "#22c55e" },
  { kind: "rain",     label: "Pluie",       tooltip: "Pluviomètre – précipitations mm/h",               Icon: CloudRain,     color: "#60a5fa" },
  { kind: "siren",    label: "Sirène",      tooltip: "Sirène + relais – commandée par CoAP",            Icon: Bell,          color: "#f43f5e" },
  { kind: "gateway",  label: "Passerelle",  tooltip: "Gateway LoRaWAN – couverture 3-5 km",             Icon: Radio,         color: "#10b981" },
]

const TOOLS: PaletteItem[] = [
  { kind: "__fire__",  label: "Allumer feu", tooltip: "Glisser sur la carte pour démarrer un feu",    Icon: Flame,    color: "#ef4444" },
  { kind: "__water__", label: "Canadair",    tooltip: "Larguer de l'eau – éteint les cellules proches", Icon: Droplets, color: "#3b82f6" },
]

function PaletteRow({ item }: { item: PaletteItem }) {
  const { kind, label, tooltip, Icon, color } = item

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("kind", kind)
    e.dataTransfer.effectAllowed = "copy"
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      title={tooltip}
      className="flex items-center gap-2 px-2 py-1.5 rounded cursor-grab active:cursor-grabbing hover:bg-white/5 select-none text-xs transition-colors group"
    >
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} />
      <span className="text-foreground/80 group-hover:text-foreground transition-colors">{label}</span>
    </div>
  )
}

interface WeatherPanelProps {
  weatherMode: string
  onModeChange: (mode: string) => void
  onPreset: (name: string) => void
}

function WeatherPanel({ weatherMode, onModeChange, onPreset }: WeatherPanelProps) {
  return (
    <div className="px-2 pb-2">
      <p className="text-[9px] text-muted-foreground uppercase tracking-widest px-1 py-1">
        Météo
      </p>

      {/* Mode selector */}
      <div className="flex gap-1 mb-2">
        {(["reel", "manuel", "prevision"] as const).map((m) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            title={m === "reel" ? "Open-Meteo temps réel" : m === "manuel" ? "Contrôle manuel" : "Rejeu prévision 48 h"}
            className={`flex-1 py-0.5 text-[9px] rounded border transition-colors font-mono uppercase ${
              weatherMode === m
                ? "bg-orange-500/20 border-orange-500/50 text-orange-400"
                : "border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
            }`}
          >
            {m === "reel" ? "Réel" : m === "manuel" ? "Manuel" : "Prévis."}
          </button>
        ))}
      </div>

      {/* Préréglages manuels */}
      {weatherMode === "manuel" && (
        <div className="grid grid-cols-2 gap-1">
          {[
            { name: "chergui", label: "Chergui", title: "Vent sec d'est 12 m/s, hum 15%", color: "#ef4444" },
            { name: "normal",  label: "Normal",  title: "Conditions normales",             color: "#22c55e" },
            { name: "pluie",   label: "Pluie",   title: "Pluie, hum 90%, vents faibles",  color: "#3b82f6" },
            { name: "nuit",    label: "Nuit",    title: "Nuit calme, hum 70%",            color: "#a78bfa" },
          ].map((p) => (
            <button
              key={p.name}
              onClick={() => onPreset(p.name)}
              title={p.title}
              className="py-1 text-[10px] rounded border border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-zinc-200 transition-colors"
              style={{ borderColor: `${p.color}30` }}
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
    <div className="flex flex-col gap-0.5 p-2">
      <p className="text-[9px] text-muted-foreground uppercase tracking-widest px-2 py-1">
        Appareils
      </p>
      {DEVICES.map((item) => (
        <PaletteRow key={item.kind} item={item} />
      ))}

      <p className="text-[9px] text-muted-foreground uppercase tracking-widest px-2 py-1 mt-2">
        Outils
      </p>
      {TOOLS.map((item) => (
        <PaletteRow key={item.kind} item={item} />
      ))}

      <div className="border-t border-border mt-2 pt-1" />

      <WeatherPanel
        weatherMode={weatherMode}
        onModeChange={onWeatherModeChange ?? (() => {})}
        onPreset={onWeatherPreset ?? (() => {})}
      />
    </div>
  )
}
