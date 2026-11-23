/**
 * Journal d'événements du centre de contrôle : niveaux d'alerte, fausses alertes
 * évitées, santé des appareils, zones déclarées. Filtrable, du plus récent au plus ancien.
 */
import { useMemo, useState } from "react"
import { ShieldCheck } from "lucide-react"
import type { FwEvent } from "@/types"
import { C, alpha, levelColor } from "@/lib/palette"
import { SegmentedControl } from "./SegmentedControl"

type Filter = "all" | "niveau" | "fausse_alerte" | "santé"

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Tout" },
  { value: "niveau", label: "Niveaux" },
  { value: "fausse_alerte", label: "Évitées" },
  { value: "santé", label: "Santé" },
]

const hhmmss = (t: number) => new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })

function dotColor(e: FwEvent): string {
  if (e.type === "niveau") return e.level === "veille" ? C.gray : levelColor(e.level ?? "")
  if (e.type === "fausse_alerte") return C.ok
  if (e.type === "santé") return e.kind === "batterie_faible" ? C.low : C.fire
  return C.gray
}

export function EventLog({ events, max = 60 }: { events: FwEvent[]; max?: number }) {
  const [filter, setFilter] = useState<Filter>("all")
  const list = useMemo(
    () => events.filter((e) => filter === "all" || e.type === filter).slice(-max).reverse(),
    [events, filter, max],
  )
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase font-semibold" style={{ color: C.text4, letterSpacing: "0.09em" }}>Journal</span>
        <span className="text-[9px] tabular" style={{ color: C.text4 }}>{list.length} év.</span>
      </div>
      <SegmentedControl options={FILTERS} value={filter} onChange={setFilter} />
      {list.length === 0 ? (
        <div className="text-[11px] py-2" style={{ color: C.text4 }}>Aucun événement.</div>
      ) : (
        <ol className="flex flex-col">
          {list.map((e) => (
            <li key={e.id} className="flex gap-2 py-1.5" style={{ borderTop: `1px solid ${C.line}` }}>
              <span className="w-1.5 h-1.5 rounded-full mt-[5px] shrink-0" style={{ background: dotColor(e) }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-medium leading-snug" style={{ color: C.text }}>{e.label}</span>
                  <span className="text-[9px] tabular shrink-0" style={{ color: C.text4 }}>{hhmmss(e.at)}</span>
                </div>
                {e.reason && <div className="text-[10px] leading-snug mt-0.5" style={{ color: C.text3 }}>{e.reason}</div>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/** Carte « fausse alerte évitée » : dernier épisode, tant qu'il est récent. */
export function FalseAlertCard({ event }: { event: FwEvent }) {
  return (
    <div className="rounded-xl px-3 py-2.5 anim-up" style={{ background: alpha(C.ok, 0.08), border: `1px solid ${alpha(C.ok, 0.25)}` }}>
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 shrink-0" style={{ color: C.ok }} />
        <span className="text-[12px] font-semibold leading-tight" style={{ color: C.text }}>{event.label}</span>
      </div>
      {event.detail && <div className="text-[11px] mt-1.5" style={{ color: C.text2 }}>{event.detail}</div>}
      {event.reason && <div className="text-[10px] mt-0.5 leading-snug" style={{ color: C.text3 }}>{event.reason}</div>}
      {event.nodes && event.nodes.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {event.nodes.map((n) => (
            <span key={n} className="px-1.5 py-0.5 rounded-md text-[9px] font-mono" style={{ background: C.fill, color: C.text2 }}>{n}</span>
          ))}
        </div>
      )}
      <div className="text-[9px] mt-1.5" style={{ color: C.text4 }}>Aucun incident ouvert · {hhmmss(event.at)}</div>
    </div>
  )
}
