interface Option<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  options: Option<T>[]
  value: T
  onChange: (v: T) => void
  className?: string
}

export function SegmentedControl<T extends string>({ options, value, onChange, className = "" }: Props<T>) {
  return (
    <div className={`flex p-0.5 rounded-[9px] bg-black/40 border border-white/8 ${className}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex-1 py-[5px] text-[10px] font-medium rounded-[7px] transition-all leading-none ${
            value === opt.value
              ? "bg-white/15 text-white shadow-sm"
              : "text-white/40 hover:text-white/70"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
