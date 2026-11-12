import { Map, BarChart2, CirclePlay } from "lucide-react"
import type { LucideIcon } from "lucide-react"

export type Page = "ops" | "perf" | "scenarios"

const NAV: { id: Page; Icon: LucideIcon; label: string }[] = [
  { id: "ops",       Icon: Map,        label: "Opérations" },
  { id: "perf",      Icon: BarChart2,  label: "Performance" },
  { id: "scenarios", Icon: CirclePlay, label: "Scénarios" },
]

interface Props {
  page: Page
  onNavigate: (p: Page) => void
}

export function Sidebar({ page, onNavigate }: Props) {
  return (
    <aside className="w-14 shrink-0 bg-black/60 border-r border-border flex flex-col items-center py-2 gap-1">
      {NAV.map(({ id, Icon, label }) => (
        <button
          key={id}
          onClick={() => onNavigate(id)}
          title={label}
          className={`w-10 h-10 flex items-center justify-center rounded transition-colors ${
            page === id
              ? "bg-orange-500/20 text-orange-400"
              : "text-muted-foreground hover:text-foreground hover:bg-white/5"
          }`}
        >
          <Icon className="w-5 h-5" />
        </button>
      ))}
    </aside>
  )
}
