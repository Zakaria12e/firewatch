import {
  Cpu,
  Thermometer,
  CloudFog,
  TriangleAlert,
  Flame,
  Camera,
  Wind,
  Leaf,
  CloudRain,
  Bell,
  Radio,
  Droplets,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { DeviceKind } from "@/types"

interface PaletteItem {
  kind: DeviceKind | "__fire__" | "__water__"
  label: string
  Icon: LucideIcon
  color: string
}

const DEVICES: PaletteItem[] = [
  { kind: "station",  label: "Station",    Icon: Cpu,           color: "#3b82f6" },
  { kind: "temp",     label: "Température", Icon: Thermometer,   color: "#f97316" },
  { kind: "smoke",    label: "Fumée",       Icon: CloudFog,      color: "#a78bfa" },
  { kind: "co",       label: "CO",          Icon: TriangleAlert, color: "#eab308" },
  { kind: "flame",    label: "Flamme",      Icon: Flame,         color: "#ef4444" },
  { kind: "thermal",  label: "Thermique",   Icon: Camera,        color: "#06b6d4" },
  { kind: "wind",     label: "Vent",        Icon: Wind,          color: "#a3a3a3" },
  { kind: "fuel",     label: "Fuel",        Icon: Leaf,          color: "#22c55e" },
  { kind: "rain",     label: "Pluie",       Icon: CloudRain,     color: "#60a5fa" },
  { kind: "siren",    label: "Sirène",      Icon: Bell,          color: "#f43f5e" },
  { kind: "gateway",  label: "Passerelle",  Icon: Radio,         color: "#10b981" },
]

const TOOLS: PaletteItem[] = [
  { kind: "__fire__",  label: "Allumer feu", Icon: Flame,    color: "#ef4444" },
  { kind: "__water__", label: "Canadair",    Icon: Droplets, color: "#3b82f6" },
]

function PaletteRow({ item }: { item: PaletteItem }) {
  const { kind, label, Icon, color } = item

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("kind", kind)
    e.dataTransfer.effectAllowed = "copy"
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="flex items-center gap-2 px-2 py-1.5 rounded cursor-grab active:cursor-grabbing hover:bg-white/5 select-none text-xs transition-colors"
    >
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} />
      <span className="text-foreground/80">{label}</span>
    </div>
  )
}

export function DevicePalette() {
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
    </div>
  )
}
