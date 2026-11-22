import { useState } from "react"
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
  // Phase 1 : press rapide vers scale 0.78 (60 ms ease-in)
  // Phase 2 : spring release overshoot (480 ms cubic-bezier)
  // → reproduit exactement la physique UITabBar d'iOS
  const [pressed, setPressed] = useState<Page | null>(null)

  const handleNav = (id: Page) => {
    onNavigate(id)
    setPressed(id)
    setTimeout(() => setPressed(null), 60) // relâche → déclenche la phase spring
  }

  return (
    <aside
      className="glass anim-left fixed left-3 top-1/2 -translate-y-1/2 z-40 rounded-[22px] flex flex-col items-center py-2 px-1.5 gap-0.5"
    >
      {NAV.map(({ id, Icon, label }, i) => {
        const active  = page === id
        const isPressing = pressed === id
        return (
          <button
            key={id}
            onPointerDown={() => handleNav(id)}
            title={label}
            className={`relative w-11 h-11 flex flex-col items-center justify-center gap-0.5 rounded-[16px] anim-left anim-d${Math.min(i + 1, 6) as 1|2|3|4|5|6}`}
            style={{ background: active ? "rgba(255,255,255,0.10)" : "transparent", transition: "background 0.2s ease" }}
          >
            <Icon
              className="w-[18px] h-[18px]"
              style={{
                color: active ? "#ffffff" : "rgba(235,235,245,0.38)",
                transform: isPressing ? "scale(0.72)" : "scale(1)",
                // Phase 1 : press rapide | Phase 2 : spring overshoot
                transition: isPressing
                  ? "transform 55ms ease-in, color 0.2s ease"
                  : "transform 480ms cubic-bezier(0.34,1.56,0.64,1), color 0.2s ease",
              }}
            />
            <span
              className="w-1 h-1 rounded-full"
              style={{
                background: active ? "#FF5A1F" : "transparent",
                boxShadow: active ? "0 0 6px rgba(255,90,31,0.55)" : "none",
                transition: "background 0.2s ease, box-shadow 0.2s ease",
              }}
            />
          </button>
        )
      })}
    </aside>
  )
}
