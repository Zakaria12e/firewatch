/**
 * Contrôles iOS de la palette FireWatch : stepper (− valeur +), curseur à piste
 * visible, interrupteur, carte de section.
 */
import { useState, type ReactNode } from "react"
import { Minus, Plus } from "lucide-react"
import { C, alpha } from "@/lib/palette"

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const decimals = (step: number) => (String(step).split(".")[1]?.length ?? 0)

/** Stepper iOS : − valeur unité + dans une seule pilule, sans flèches du navigateur. */
export function Stepper({ value, onChange, min, max, step = 1, unit, label }: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  unit?: string
  label: string
}) {
  const d = decimals(step)
  // texte libre seulement pendant la saisie ; sinon la valeur fait foi
  const [editing, setEditing] = useState<string | null>(null)
  const text = editing ?? value.toFixed(d)
  const commit = (raw: string) => {
    const v = parseFloat(raw.replace(",", "."))
    if (Number.isFinite(v)) onChange(Number(clamp(v, min, max).toFixed(d)))
    setEditing(null)
  }
  const bump = (dir: 1 | -1) => onChange(Number(clamp(value + dir * step, min, max).toFixed(d)))
  const btn = "w-7 h-7 flex items-center justify-center rounded-full shrink-0 disabled:opacity-30"
  return (
    <div className="flex items-center h-8 rounded-full pl-0.5 pr-0.5 shrink-0"
      style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${C.line}` }}>
      <button type="button" className={btn} onClick={() => bump(-1)} disabled={value <= min}
        aria-label={`Diminuer ${label}`} style={{ color: C.text2 }}>
        <Minus className="w-3.5 h-3.5" />
      </button>
      <div className="flex items-baseline justify-center gap-1 px-1" style={{ minWidth: 74 }}>
        <input
          className="fw-num bg-transparent text-right text-[12px] font-semibold tabular outline-none"
          style={{ width: `${Math.max(2, text.length) + 0.5}ch`, color: C.text }}
          type="text"
          inputMode="decimal"
          aria-label={label}
          value={text}
          onFocus={() => setEditing(value.toFixed(d))}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur()
            if (e.key === "ArrowUp") { e.preventDefault(); bump(1) }
            if (e.key === "ArrowDown") { e.preventDefault(); bump(-1) }
          }}
        />
        {unit && <span className="text-[10px]" style={{ color: C.text3 }}>{unit}</span>}
      </div>
      <button type="button" className={btn} onClick={() => bump(1)} disabled={value >= max}
        aria-label={`Augmenter ${label}`} style={{ color: C.text2 }}>
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

/** Curseur : libellé + valeur côte à côte, piste grise, partie remplie orange. */
export function Slider({ label, value, onChange, min, max, step = 1, unit }: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  unit?: string
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <label className="block">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-[12px]" style={{ color: C.text2 }}>{label}</span>
        <span className="text-[12px] font-semibold tabular" style={{ color: C.text }}>
          {value}{unit && <span className="text-[10px] font-normal ml-0.5" style={{ color: C.text3 }}>{unit}</span>}
        </span>
      </div>
      <input
        type="range"
        className="fw-range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ["--fill" as string]: `${pct}%` }}
      />
    </label>
  )
}

/** Interrupteur iOS (orange quand actif). */
export function Toggle({ checked, onChange, label, disabled }: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative w-[38px] h-[23px] rounded-full shrink-0 disabled:opacity-40"
      style={{ background: checked ? C.fire : C.gray, transition: "background 0.2s ease" }}
    >
      <span
        className="absolute top-[2px] w-[19px] h-[19px] rounded-full bg-white"
        style={{
          left: checked ? 17 : 2,
          boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
          transition: "left 0.22s cubic-bezier(0.34,1.4,0.64,1)",
        }}
      />
    </button>
  )
}

/** Carte de section en verre. */
export function Card({ title, subtitle, icon, children, right }: {
  title: string
  subtitle?: string
  icon?: ReactNode
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col min-w-0" style={{
      background: "rgba(255,255,255,0.035)",
      border: `1px solid ${C.line}`,
      borderRadius: 16,
    }}>
      <header className="flex items-center gap-2.5 px-4 pt-3.5 pb-3" style={{ borderBottom: `1px solid ${C.line}` }}>
        {icon && (
          <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: alpha(C.fire, 0.14), color: C.fire }}>
            {icon}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-[13px] font-semibold leading-tight" style={{ color: C.text, letterSpacing: "-0.2px" }}>{title}</h2>
          {subtitle && <p className="text-[11px] mt-0.5" style={{ color: C.text3 }}>{subtitle}</p>}
        </div>
        {right}
      </header>
      <div className="px-4 py-3 flex flex-col gap-3 flex-1">{children}</div>
    </section>
  )
}

/** Ligne libellé (+ aide) / contrôle. */
export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 min-h-8">
      <div className="min-w-0">
        <div className="text-[12px]" style={{ color: C.text2 }}>{label}</div>
        {hint && <div className="text-[10px] mt-0.5" style={{ color: C.text4 }}>{hint}</div>}
      </div>
      {children}
    </div>
  )
}
