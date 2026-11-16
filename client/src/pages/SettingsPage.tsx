import { useEffect, useState } from "react"
import { Bell, Save } from "lucide-react"
import type { AppSettings } from "@/types"

function Section({ title, children, delay = 0 }: { title: string; children: React.ReactNode; delay?: number }) {
  return (
    <div
      className={`anim-up anim-d${delay as 1|2|3|4}`}
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      <div className="px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <span className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: "rgba(235,235,245,0.35)", letterSpacing: "0.09em" }}>
          {title}
        </span>
      </div>
      <div className="px-4 py-3 space-y-2.5">
        {children}
      </div>
    </div>
  )
}

function NumField({
  label, value, unit, onChange, min, max, step,
}: {
  label: string; value: number; unit?: string
  onChange: (v: number) => void; min?: number; max?: number; step?: number
}) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span className="text-[11px]" style={{ color: "rgba(235,235,245,0.55)" }}>{label}</span>
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="number"
          value={value}
          min={min} max={max} step={step ?? 1}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-16 text-[11px] font-mono text-right focus:outline-none"
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 8,
            padding: "3px 8px",
            color: "rgba(235,235,245,0.80)",
            transition: "border-color 0.15s ease",
          }}
          onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,159,10,0.5)" }}
          onBlur={(e)  => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.10)" }}
        />
        {unit && <span className="text-[10px] w-10" style={{ color: "rgba(235,235,245,0.3)" }}>{unit}</span>}
      </div>
    </label>
  )
}

function RangeField({
  label, value, onChange, min, max,
}: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number
}) {
  return (
    <label className="flex items-center gap-3">
      <span className="text-[11px] w-28 shrink-0" style={{ color: "rgba(235,235,245,0.55)" }}>{label}</span>
      <div className="flex-1 relative">
        <input
          type="range"
          value={value}
          min={min} max={max}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-1 rounded-full appearance-none cursor-pointer"
          style={{ accentColor: "#ff9f0a" }}
        />
      </div>
      <span className="text-[11px] tabular w-7 text-right font-mono" style={{ color: "rgba(235,235,245,0.55)" }}>{value}</span>
    </label>
  )
}

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [saved,    setSaved]    = useState(false)
  const [testing,  setTesting]  = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then(setSettings).catch(() => {})
  }, [])

  const save = async () => {
    if (!settings) return
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const testAlert = async () => {
    setTesting(true); setTestResult(null)
    try {
      const r = await fetch("/api/alert/test", { method: "POST" })
      const d = await r.json()
      setTestResult(d.ok ? `Envoyé : ${d.sent.join(", ")}` : "Aucun canal configuré")
    } catch { setTestResult("Erreur réseau") }
    setTesting(false)
  }

  const setThreshold = (key: keyof AppSettings["thresholds"], v: number) =>
    setSettings((s) => s ? { ...s, thresholds: { ...s.thresholds, [key]: v } } : s)

  const setFusion = (key: keyof AppSettings["fusion"], v: number) =>
    setSettings((s) => s ? { ...s, fusion: { ...s.fusion, [key]: v } } : s)

  if (!settings) {
    return (
      <div className="flex-1 flex items-center justify-center text-[12px]" style={{ color: "rgba(235,235,245,0.35)" }}>
        Chargement…
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* En-tête */}
      <div className="shrink-0 px-5 pt-4 pb-3 anim-down flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="text-[13px] font-semibold text-white/90" style={{ letterSpacing: "-0.374px" }}>Paramètres</div>

        {/* Bouton sauvegarder */}
        <button
          onClick={save}
          className="spring-hover flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] font-semibold rounded-full"
          style={{
            background: saved ? "rgba(48,209,88,0.18)" : "rgba(255,159,10,0.18)",
            border: `1px solid ${saved ? "rgba(48,209,88,0.35)" : "rgba(255,159,10,0.35)"}`,
            color: saved ? "#30d158" : "#ff9f0a",
            transition: "all 0.3s ease",
          }}
        >
          <Save className="w-3 h-3" />
          {saved ? "Enregistré ✓" : "Sauvegarder"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 max-w-xl">
        {/* Seuils */}
        <Section title="Seuils de détection" delay={1}>
          <NumField label="Fumée (seuil absolu)"    value={settings.thresholds.smokePpm}      onChange={(v) => setThreshold("smokePpm", v)}      unit="ppm"    min={50}  max={1000} />
          <NumField label="CO (seuil absolu)"        value={settings.thresholds.coPpm}         onChange={(v) => setThreshold("coPpm", v)}         unit="ppm"    min={5}   max={200} />
          <NumField label="Montée température"       value={settings.thresholds.tempRisePerMin} onChange={(v) => setThreshold("tempRisePerMin", v)} unit="°C/min" min={1}   max={20}  step={0.5} />
          <NumField label="Chute humidité"           value={settings.thresholds.humDropPerMin}  onChange={(v) => setThreshold("humDropPerMin", v)}  unit="%/min"  min={1}   max={30} />
          <NumField label="Caméra thermique"         value={settings.thresholds.tmaxHot}        onChange={(v) => setThreshold("tmaxHot", v)}        unit="°C"     min={30}  max={150} />
        </Section>

        {/* Poids fusion */}
        <Section title="Poids de la fusion" delay={2}>
          <RangeField label="Flamme IR"      value={settings.fusion.weightFlame}    min={0} max={100} onChange={(v) => setFusion("weightFlame", v)} />
          <RangeField label="Thermique"      value={settings.fusion.weightThermal}  min={0} max={100} onChange={(v) => setFusion("weightThermal", v)} />
          <RangeField label="Fumée"          value={settings.fusion.weightSmoke}    min={0} max={100} onChange={(v) => setFusion("weightSmoke", v)} />
          <RangeField label="CO"             value={settings.fusion.weightCO}       min={0} max={100} onChange={(v) => setFusion("weightCO", v)} />
          <RangeField label="Montée temp."   value={settings.fusion.weightTempRise} min={0} max={100} onChange={(v) => setFusion("weightTempRise", v)} />
          <RangeField label="Chute humidité" value={settings.fusion.weightHumDrop}  min={0} max={100} onChange={(v) => setFusion("weightHumDrop", v)} />
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 10, marginTop: 4 }} className="space-y-2.5">
            <NumField label="Score confirmation (≥)" value={settings.fusion.minConfirmScore}   onChange={(v) => setFusion("minConfirmScore", v)}   unit="%" min={50} max={100} />
            <NumField label="Score pré-alerte (≥)"   value={settings.fusion.minPreAlertScore}  onChange={(v) => setFusion("minPreAlertScore", v)}  unit="%" min={20} max={80} />
            <NumField label="Score suspicion (≥)"    value={settings.fusion.minSuspicionScore} onChange={(v) => setFusion("minSuspicionScore", v)} unit="%" min={5}  max={50} />
          </div>
        </Section>

        {/* Alertes */}
        <Section title="Canaux d'alerte" delay={3}>
          <p className="text-[11px]" style={{ color: "rgba(235,235,245,0.35)" }}>
            Canaux configurés via <code className="font-mono text-[10px] px-1 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.08)", color: "rgba(235,235,245,0.60)" }}>.env</code> (ntfy / Pushover).
          </p>
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={testAlert}
              disabled={testing}
              className="spring-hover flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] font-medium rounded-full disabled:opacity-50"
              style={{
                background: "rgba(10,132,255,0.14)",
                border: "1px solid rgba(10,132,255,0.28)",
                color: "#0a84ff",
              }}
            >
              <Bell className="w-3 h-3" />
              {testing ? "Envoi…" : "Tester alertes iPhone"}
            </button>
            {testResult && (
              <span className="text-[10px]" style={{ color: "rgba(235,235,245,0.4)" }}>{testResult}</span>
            )}
          </div>
        </Section>

        {/* Note */}
        <div className="text-[10px] pb-4" style={{ color: "rgba(235,235,245,0.22)" }}>
          Les seuils et poids sont enregistrés en mémoire et pris en compte au prochain démarrage du serveur.
        </div>
      </div>
    </div>
  )
}
