import { Map, BarChart2, CirclePlay, Cpu, Clock, Settings } from "lucide-react"
import type { LucideIcon } from "lucide-react"

export type Page = "ops" | "perf" | "scenarios" | "devices" | "incidents" | "settings"

const NAV: { id: Page; Icon: LucideIcon; label: string }[] = [
  { id: "ops",       Icon: Map,        label: "Opérations" },
  { id: "devices",   Icon: Cpu,        label: "Appareils" },
  { id: "perf",      Icon: BarChart2,  label: "Performance" },
  { id: "scenarios", Icon: CirclePlay, label: "Scénarios" },
  { id: "incidents", Icon: Clock,      label: "Incidents" },
  { id: "settings",  Icon: Settings,   label: "Paramètres" },
]

interface Props {
  page: Page
  onNavigate: (p: Page) => void
}

export function Sidebar({ page, onNavigate }: Props) {
  return (
    <aside
      className="glass anim-left fixed left-3 top-1/2 -translate-y-1/2 z-40 rounded-[22px] flex flex-col items-center py-2 px-1.5 gap-0.5"
    >
      {NAV.map(({ id, Icon, label }, i) => {
        const active = page === id
        return (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            title={label}
            className={`relative w-11 h-11 flex flex-col items-center justify-center gap-0.5 rounded-[16px] spring-hover anim-left anim-d${Math.min(i + 1, 6) as 1|2|3|4|5|6}`}
            style={{
              background: active ? "rgba(255,255,255,0.10)" : "transparent",
            }}
          >
            <Icon
              className="w-[18px] h-[18px]"
              style={{
                color: active ? "#ffffff" : "rgba(235,235,245,0.38)",
                transition: "color 0.2s ease",
              }}
            />
            <span
              className="w-1 h-1 rounded-full"
              style={{
                background: active ? "#ff9f0a" : "transparent",
                boxShadow: active ? "0 0 6px #ff9f0a80" : "none",
                transition: "background 0.2s ease, box-shadow 0.2s ease",
              }}
            />
          </button>
        )
      })}
    </aside>
  )
}
