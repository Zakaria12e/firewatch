interface Option<T extends string> {
  value: T
  label: string
  /** pastille d'état optionnelle (couleur) */
  dot?: string
  count?: number
}

interface Props<T extends string> {
  options: Option<T>[]
  value: T
  onChange: (v: T) => void
  className?: string
  /** largeur naturelle (sinon les segments se partagent la largeur) */
  compact?: boolean
}

/** Contrôle segmenté iOS : segment actif gris #474747, texte blanc. */
export function SegmentedControl<T extends string>({ options, value, onChange, className = "", compact = false }: Props<T>) {
  return (
    <div
      role="tablist"
      className={`flex p-0.5 rounded-[9px] ${compact ? "inline-flex" : ""} ${className}`}
      style={{ background: "rgba(0,0,0,0.45)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`${compact ? "px-2.5" : "flex-1"} py-[5px] text-[10px] font-medium rounded-[7px] leading-none flex items-center justify-center gap-1 whitespace-nowrap`}
            style={{
              background: active ? "#474747" : "transparent",
              color: active ? "#ffffff" : "rgba(255,255,255,0.45)",
              boxShadow: active ? "0 1px 3px rgba(0,0,0,0.4)" : "none",
              transition: "background 0.18s ease, color 0.18s ease",
            }}
          >
            {opt.dot && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: opt.dot }} />}
            {opt.label}
            {opt.count !== undefined && <span className="tabular" style={{ opacity: 0.55 }}>{opt.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
