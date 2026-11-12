import { useEffect, useState } from "react"
import { Bell } from "lucide-react"
import type { AppSettings } from "@/types"

function NumField({
  label,
  value,
  unit,
  onChange,
  min,
  max,
  step,
}: {
  label: string
  value: number
  unit?: string
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step ?? 1}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20 bg-black/40 border border-border rounded px-2 py-0.5 text-xs font-mono text-right focus:outline-none focus:border-orange-500/50"
        />
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
    </label>
  )
}

function RangeField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
}) {
  return (
    <label className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-32 shrink-0">{label}</span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-orange-500"
      />
      <span className="text-xs font-mono w-8 text-right">{value}</span>
    </label>
  )
}

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => {})
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
    setTesting(true)
    setTestResult(null)
    try {
      const r = await fetch("/api/alert/test", { method: "POST" })
      const d = await r.json()
      setTestResult(d.ok ? `Envoyé : ${d.sent.join(", ")}` : "Aucun canal configuré")
    } catch {
      setTestResult("Erreur réseau")
    }
    setTesting(false)
  }

  const setThreshold = (key: keyof AppSettings["thresholds"], v: number) =>
    setSettings((s) => s ? { ...s, thresholds: { ...s.thresholds, [key]: v } } : s)

  const setFusion = (key: keyof AppSettings["fusion"], v: number) =>
    setSettings((s) => s ? { ...s, fusion: { ...s.fusion, [key]: v } } : s)

  if (!settings) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Chargement…
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-8 max-w-2xl">
      <h2 className="text-lg font-semibold text-orange-400 uppercase tracking-widest">Paramètres</h2>

      {/* Seuils */}
      <section className="space-y-3">
        <div className="text-xs text-muted-foreground uppercase tracking-wider border-b border-border pb-2">
          Seuils de détection
        </div>
        <NumField label="Fumée (seuil absolu)" value={settings.thresholds.smokePpm}
          onChange={(v) => setThreshold("smokePpm", v)} unit="ppm" min={50} max={1000} />
        <NumField label="CO (seuil absolu)" value={settings.thresholds.coPpm}
          onChange={(v) => setThreshold("coPpm", v)} unit="ppm" min={5} max={200} />
        <NumField label="Montée de température" value={settings.thresholds.tempRisePerMin}
          onChange={(v) => setThreshold("tempRisePerMin", v)} unit="°C/min" min={1} max={20} step={0.5} />
        <NumField label="Chute d'humidité" value={settings.thresholds.humDropPerMin}
          onChange={(v) => setThreshold("humDropPerMin", v)} unit="%/min" min={1} max={30} />
        <NumField label="Caméra thermique (seuil)" value={settings.thresholds.tmaxHot}
          onChange={(v) => setThreshold("tmaxHot", v)} unit="°C" min={30} max={150} />
      </section>

      {/* Poids fusion */}
      <section className="space-y-3">
        <div className="text-xs text-muted-foreground uppercase tracking-wider border-b border-border pb-2">
          Poids de la fusion
        </div>
        <RangeField label="Flamme IR" value={settings.fusion.weightFlame} min={0} max={100}
          onChange={(v) => setFusion("weightFlame", v)} />
        <RangeField label="Thermique" value={settings.fusion.weightThermal} min={0} max={100}
          onChange={(v) => setFusion("weightThermal", v)} />
        <RangeField label="Fumée" value={settings.fusion.weightSmoke} min={0} max={100}
          onChange={(v) => setFusion("weightSmoke", v)} />
        <RangeField label="CO" value={settings.fusion.weightCO} min={0} max={100}
          onChange={(v) => setFusion("weightCO", v)} />
        <RangeField label="Montée de temp." value={settings.fusion.weightTempRise} min={0} max={100}
          onChange={(v) => setFusion("weightTempRise", v)} />
        <RangeField label="Chute d'humidité" value={settings.fusion.weightHumDrop} min={0} max={100}
          onChange={(v) => setFusion("weightHumDrop", v)} />
        <div className="border-t border-border/40 pt-3 space-y-3">
          <NumField label="Score de confirmation (≥)" value={settings.fusion.minConfirmScore}
            onChange={(v) => setFusion("minConfirmScore", v)} unit="%" min={50} max={100} />
          <NumField label="Score de pré-alerte (≥)" value={settings.fusion.minPreAlertScore}
            onChange={(v) => setFusion("minPreAlertScore", v)} unit="%" min={20} max={80} />
          <NumField label="Score de suspicion (≥)" value={settings.fusion.minSuspicionScore}
            onChange={(v) => setFusion("minSuspicionScore", v)} unit="%" min={5} max={50} />
        </div>
      </section>

      {/* Alertes */}
      <section className="space-y-3">
        <div className="text-xs text-muted-foreground uppercase tracking-wider border-b border-border pb-2">
          Canaux d'alerte
        </div>
        <div className="flex flex-col gap-2 text-xs text-muted-foreground">
          <p>Les canaux (ntfy / Pushover) sont configurés via les variables d'environnement dans <code className="font-mono text-xs bg-black/40 px-1 py-0.5 rounded">.env</code>.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={testAlert}
            disabled={testing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border hover:border-orange-500/50 hover:text-orange-400 transition-colors disabled:opacity-50"
          >
            <Bell className="w-3.5 h-3.5" />
            {testing ? "Envoi…" : "Tester les alertes iPhone"}
          </button>
          {testResult && (
            <span className="text-xs text-muted-foreground">{testResult}</span>
          )}
        </div>
      </section>

      {/* Bouton sauvegarder */}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          className="px-4 py-1.5 text-sm rounded bg-orange-500/20 border border-orange-500/40 text-orange-400 hover:bg-orange-500/30 transition-colors"
        >
          Sauvegarder
        </button>
        {saved && <span className="text-xs text-green-400">Enregistré ✓</span>}
      </div>

      <div className="text-xs text-muted-foreground pb-4">
        Note : les seuils et poids modifiés ici sont enregistrés en mémoire et pris en compte
        au prochain démarrage du serveur. Le câblage dynamique dans le pipeline est prévu à l'étape 6.
      </div>
    </div>
  )
}
