import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  Gauge, SlidersHorizontal, Flame, Bell, CloudSun, Sparkles, Plus, Trash2, RotateCcw, Check, Send,
} from "lucide-react"
import type { AppSettings, AlertChannels, BurnZone, FusionWeights } from "@/types"
import { C, alpha } from "@/lib/palette"
import { Card, Row, Slider, Stepper, Toggle } from "@/components/controls"
import { SegmentedControl } from "@/components/SegmentedControl"
import {
  QUALITY_LABEL, QUALITY_PRESETS, setEffectsQuality, setShowFps,
  useEffectsQuality, useReducedMotion, useShowFps, type EffectsQuality,
} from "@/map3d/quality"

const WEIGHT_KEYS: { key: keyof FusionWeights; label: string }[] = [
  { key: "weightFlame", label: "Flamme IR" },
  { key: "weightThermal", label: "Point chaud thermique" },
  { key: "weightSmoke", label: "Fumée" },
  { key: "weightCO", label: "CO" },
  { key: "weightTempRise", label: "Montée de température" },
  { key: "weightHumDrop", label: "Chute d'humidité" },
]

const WEATHER_OPTIONS = [
  { value: "reel", label: "Réel (Open-Meteo)" },
  { value: "manuel", label: "Manuel" },
  { value: "prevision", label: "Prévision 48 h" },
]

const PRESETS = [
  { name: "chergui", label: "Chergui", hint: "36 °C · 18 % · vent d'est 7 m/s" },
  { name: "normal", label: "Normal", hint: "24 °C · 45 % · 3 m/s" },
  { name: "pluie", label: "Pluie", hint: "16 °C · 85 % · 5 mm/h" },
  { name: "nuit", label: "Nuit", hint: "18 °C · 55 % · 1,5 m/s" },
]

/** Polygone circulaire [[lat, lon], …] (zones de brûlage). */
function circle(lat: number, lon: number, radiusM: number, steps = 24): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI
    out.push([
      Number((lat + (radiusM / 111_320) * Math.cos(a)).toFixed(6)),
      Number((lon + (radiusM / (111_320 * Math.cos((lat * Math.PI) / 180))) * Math.sin(a)).toFixed(6)),
    ])
  }
  return out
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

interface Props {
  weatherMode: string
  onWeatherModeChange: (mode: string) => void
  onWeatherPreset: (name: string) => void
}

export function SettingsPage({ weatherMode, onWeatherModeChange, onWeatherPreset }: Props) {
  const [saved, setSaved] = useState<AppSettings | null>(null)
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [channels, setChannels] = useState<AlertChannels | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [zoneForm, setZoneForm] = useState({ name: "", lat: 35.135, lon: -5.215, radius: 250 })
  const quality = useEffectsQuality()
  const showFps = useShowFps()
  const reduced = useReducedMotion()

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((s: AppSettings) => { setSaved(s); setDraft(s) }).catch(() => {})
    fetch("/api/alerts/channels").then((r) => r.json()).then(setChannels).catch(() => {})
  }, [])

  const dirty = useMemo(() => !!draft && !!saved && !same(draft, saved), [draft, saved])
  const totalWeight = draft ? WEIGHT_KEYS.reduce((s, w) => s + (draft.fusion[w.key] as number), 0) : 0

  if (!draft) {
    return (
      <div className="flex-1 flex items-center justify-center text-[12px]" style={{ color: C.text3 }}>
        Chargement des paramètres…
      </div>
    )
  }

  const setT = (key: keyof AppSettings["thresholds"], v: number) =>
    setDraft((s) => s && { ...s, thresholds: { ...s.thresholds, [key]: v } })
  const setF = (key: keyof FusionWeights, v: number) =>
    setDraft((s) => s && { ...s, fusion: { ...s.fusion, [key]: v } })
  const setA = (key: keyof AppSettings["alerts"], v: boolean) =>
    setDraft((s) => s && { ...s, alerts: { ...s.alerts, [key]: v } })

  const save = async () => {
    if (!dirty) {
      toast("Aucune modification", { description: "Les paramètres affichés sont déjà enregistrés." })
      return
    }
    setSaving(true)
    try {
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      })
      if (!r.ok) throw new Error(String(r.status))
      const s: AppSettings = await r.json()
      setSaved(s); setDraft(s)
      toast.success("Paramètres enregistrés", { description: "La détection les applique dès la prochaine évaluation." })
    } catch {
      toast.error("Échec de l'enregistrement", { description: "Serveur injoignable." })
    }
    setSaving(false)
  }

  const restoreDefaults = async () => {
    try {
      const d: AppSettings = await (await fetch("/api/settings/defaults")).json()
      setDraft({ ...d, burnZones: draft.burnZones })
      toast("Valeurs par défaut chargées", { description: "Seuils, poids et canaux. Cliquez sur Enregistrer pour les appliquer." })
    } catch {
      toast.error("Valeurs par défaut indisponibles")
    }
  }

  const testAlert = async () => {
    setTesting(true)
    try {
      const d = await (await fetch("/api/alert/test", { method: "POST" })).json()
      if (d.ok) toast.success("Alerte de test envoyée", { description: `Canaux : ${d.sent.join(", ")}` })
      else toast.error("Aucune alerte envoyée", { description: "Aucun canal configuré et activé." })
    } catch {
      toast.error("Erreur réseau pendant le test")
    }
    setTesting(false)
  }

  const addZone = () => {
    const name = zoneForm.name.trim() || `Brûlage ${draft.burnZones.length + 1}`
    const zone: BurnZone = {
      id: `Z${Date.now().toString(36)}`,
      name,
      center: { lat: zoneForm.lat, lon: zoneForm.lon },
      radius: zoneForm.radius,
      polygon: circle(zoneForm.lat, zoneForm.lon, zoneForm.radius),
    }
    setDraft((s) => s && { ...s, burnZones: [...s.burnZones, zone] })
    setZoneForm((z) => ({ ...z, name: "" }))
  }

  const ch = channels
  const chanStatus = (configured: boolean | undefined) => (
    <span className="flex items-center gap-1 text-[10px]" style={{ color: configured ? C.text2 : C.text4 }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: configured ? C.ok : C.gray }} />
      {configured ? "Configuré" : "Non configuré (.env)"}
    </span>
  )

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* En-tête */}
      <div className="shrink-0 px-6 pt-5 pb-4 flex items-end justify-between gap-4" style={{ borderBottom: `1px solid ${C.line}` }}>
        <div>
          <h1 className="text-[18px] font-semibold" style={{ color: C.text, letterSpacing: "-0.4px" }}>Paramètres</h1>
          <p className="text-[12px] mt-0.5" style={{ color: C.text3 }}>
            Détection, alertes, météo du monde simulé et rendu 3D de la carte.
          </p>
        </div>
      </div>

      {/* Contenu défilant */}
      <div className="flex-1 min-h-0 fw-scroll">
        <div className="grid gap-4 p-6 grid-cols-1 xl:grid-cols-2">
          {/* 1. Seuils */}
          <Card title="Seuils de détection" subtitle="Indicateurs calculés par appareil (§6.4)" icon={<Gauge className="w-4 h-4" />}>
            <Row label="Fumée" hint="Seuil absolu MQ-2 (ou z-score > 4)">
              <Stepper label="Seuil fumée" value={draft.thresholds.smokePpm} onChange={(v) => setT("smokePpm", v)} min={50} max={1000} step={10} unit="ppm" />
            </Row>
            <Row label="Monoxyde de carbone" hint="Seuil absolu MQ-7">
              <Stepper label="Seuil CO" value={draft.thresholds.coPpm} onChange={(v) => setT("coPpm", v)} min={5} max={200} step={1} unit="ppm" />
            </Row>
            <Row label="Montée de température">
              <Stepper label="Montée de température" value={draft.thresholds.tempRisePerMin} onChange={(v) => setT("tempRisePerMin", v)} min={0.5} max={20} step={0.5} unit="°C/min" />
            </Row>
            <Row label="Chute d'humidité">
              <Stepper label="Chute d'humidité" value={draft.thresholds.humDropPerMin} onChange={(v) => setT("humDropPerMin", v)} min={1} max={30} step={1} unit="%/min" />
            </Row>
            <Row label="Flamme IR" hint="Intensité KY-026 (0-1)">
              <Stepper label="Seuil IR" value={draft.thresholds.irHot} onChange={(v) => setT("irHot", v)} min={0.1} max={1} step={0.05} />
            </Row>
            <Row label="Point chaud thermique" hint="Température max. MLX90640">
              <Stepper label="Seuil thermique" value={draft.thresholds.tmaxHot} onChange={(v) => setT("tmaxHot", v)} min={30} max={150} step={1} unit="°C" />
            </Row>
          </Card>

          {/* 2. Poids */}
          <Card
            title="Poids de la fusion"
            subtitle="Score de confiance 0-100, normalisé par le total"
            icon={<SlidersHorizontal className="w-4 h-4" />}
            right={
              <div className="text-right">
                <div className="text-[10px]" style={{ color: C.text4 }}>Total</div>
                <div className="text-[15px] font-semibold tabular" style={{ color: C.fire }}>{totalWeight}</div>
              </div>
            }
          >
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {WEIGHT_KEYS.map((w) => (
                <Slider key={w.key} label={w.label} value={draft.fusion[w.key] as number} onChange={(v) => setF(w.key, v)} min={0} max={100} />
              ))}
            </div>
            <div className="h-px" style={{ background: C.line }} />
            <Row label="Feu confirmé" hint="Score minimal">
              <Stepper label="Score de confirmation" value={draft.fusion.minConfirmScore} onChange={(v) => setF("minConfirmScore", v)} min={50} max={100} unit="/100" />
            </Row>
            <Row label="Pré-alerte" hint="Score minimal">
              <Stepper label="Score de pré-alerte" value={draft.fusion.minPreAlertScore} onChange={(v) => setF("minPreAlertScore", v)} min={20} max={90} unit="/100" />
            </Row>
            <Row label="Suspicion" hint="Score minimal">
              <Stepper label="Score de suspicion" value={draft.fusion.minSuspicionScore} onChange={(v) => setF("minSuspicionScore", v)} min={5} max={60} unit="/100" />
            </Row>
          </Card>

          {/* 3. Zones de brûlage */}
          <Card title="Zones de brûlage déclarées" subtitle="Une source dans une zone → « brûlage autorisé », pas d'incident" icon={<Flame className="w-4 h-4" />}>
            {draft.burnZones.length === 0 ? (
              <div className="text-[12px] py-2" style={{ color: C.text4 }}>Aucune zone déclarée.</div>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {draft.burnZones.map((z) => (
                  <li key={z.id} className="flex items-center gap-3 px-3 py-2 rounded-xl" style={{ background: C.fill }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: C.ember, boxShadow: `0 0 0 2px ${alpha(C.fire, 0.35)}` }} />
                    <span className="text-[12px] font-medium flex-1 truncate" style={{ color: C.text }}>{z.name}</span>
                    <span className="text-[11px] font-mono tabular" style={{ color: C.text3 }}>
                      {z.center ? `${z.center.lat.toFixed(4)}, ${z.center.lon.toFixed(4)}` : `${z.polygon.length} points`}
                    </span>
                    {z.radius !== undefined && <span className="text-[11px] tabular w-14 text-right" style={{ color: C.text3 }}>{z.radius} m</span>}
                    <button
                      onClick={() => setDraft((s) => s && { ...s, burnZones: s.burnZones.filter((x) => x.id !== z.id) })}
                      className="w-7 h-7 flex items-center justify-center rounded-full spring-hover"
                      style={{ color: C.text3 }}
                      title={`Supprimer ${z.name}`}
                      aria-label={`Supprimer ${z.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-col gap-2.5 p-3 rounded-xl" style={{ border: `1px dashed ${C.line}` }}>
              <input
                value={zoneForm.name}
                onChange={(e) => setZoneForm((z) => ({ ...z, name: e.target.value }))}
                placeholder="Nom de la zone (ex. parcelle Akchour)"
                className="h-8 px-3 rounded-full text-[12px] outline-none"
                style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${C.line}`, color: C.text }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Stepper label="Latitude" value={zoneForm.lat} onChange={(v) => setZoneForm((z) => ({ ...z, lat: v }))} min={34.9} max={35.4} step={0.0005} unit="N" />
                <Stepper label="Longitude" value={zoneForm.lon} onChange={(v) => setZoneForm((z) => ({ ...z, lon: v }))} min={-5.5} max={-4.9} step={0.0005} unit="E" />
                <Stepper label="Rayon" value={zoneForm.radius} onChange={(v) => setZoneForm((z) => ({ ...z, radius: v }))} min={50} max={2000} step={50} unit="m" />
                <button
                  onClick={addZone}
                  className="h-8 px-3.5 rounded-full text-[12px] font-medium flex items-center gap-1.5 spring-hover ml-auto"
                  style={{ background: alpha(C.fire, 0.16), border: `1px solid ${alpha(C.fire, 0.35)}`, color: C.fire }}
                >
                  <Plus className="w-3.5 h-3.5" /> Ajouter
                </button>
              </div>
            </div>
          </Card>

          {/* 4. Alertes */}
          <Card title="Alertes" subtitle="Notifications envoyées à la confirmation d'un feu" icon={<Bell className="w-4 h-4" />}>
            <Row label="ntfy" hint={ch?.ntfy.topic ? `Sujet : ${ch.ntfy.topic} · priorité 5` : "POST JSON sur ntfy.sh"}>
              <div className="flex items-center gap-3">
                {chanStatus(ch?.ntfy.configured)}
                <Toggle label="Activer ntfy" checked={draft.alerts.ntfyEnabled} onChange={(v) => setA("ntfyEnabled", v)} />
              </div>
            </Row>
            <Row label="Pushover" hint="Priorité 2 (urgence), son « siren » : alarme sur iPhone">
              <div className="flex items-center gap-3">
                {chanStatus(ch?.pushover.configured)}
                <Toggle label="Activer Pushover" checked={draft.alerts.pushoverEnabled} onChange={(v) => setA("pushoverEnabled", v)} />
              </div>
            </Row>
            <Row label="Dashboard" hint="Sirène Web Audio + toasts tant qu'un incident n'est pas acquitté">
              <span className="text-[11px]" style={{ color: C.text3 }}>Toujours actif</span>
            </Row>
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={testAlert}
                disabled={testing}
                className="h-9 px-4 rounded-full text-[12px] font-medium flex items-center gap-2 spring-hover disabled:opacity-50"
                style={{ background: "rgba(255,255,255,0.08)", border: `1px solid ${C.line}`, color: C.text }}
              >
                <Send className="w-3.5 h-3.5" style={{ color: C.fire }} />
                {testing ? "Envoi…" : "Tester l'alerte iPhone"}
              </button>
              {dirty && <span className="text-[10px]" style={{ color: C.text4 }}>Le test utilise les canaux enregistrés.</span>}
            </div>
          </Card>

          {/* 5. Météo */}
          <Card title="Météo" subtitle="Source de la météo du monde simulé — appliqué immédiatement" icon={<CloudSun className="w-4 h-4" />}>
            <SegmentedControl options={WEATHER_OPTIONS} value={weatherMode} onChange={onWeatherModeChange} />
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => {
                    onWeatherPreset(p.name)
                    toast(`Préréglage « ${p.label} » appliqué`, { description: "Mode météo : manuel." })
                  }}
                  className="text-left px-3 py-2.5 rounded-xl spring-hover"
                  style={{ background: C.fill, border: `1px solid ${p.name === "chergui" ? alpha(C.fire, 0.35) : C.line}` }}
                >
                  <div className="text-[12px] font-medium" style={{ color: p.name === "chergui" ? C.fire : C.text }}>{p.label}</div>
                  <div className="text-[10px] mt-0.5 tabular" style={{ color: C.text4 }}>{p.hint}</div>
                </button>
              ))}
            </div>
          </Card>

          {/* 6. Qualité 3D */}
          <Card title="Qualité des effets 3D" subtitle="Particules de la carte — réglage local, appliqué immédiatement" icon={<Sparkles className="w-4 h-4" />}>
            <SegmentedControl
              options={(Object.keys(QUALITY_LABEL) as EffectsQuality[]).map((q) => ({ value: q, label: QUALITY_LABEL[q] }))}
              value={quality}
              onChange={(q) => setEffectsQuality(q)}
            />
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { l: "Flammes", v: QUALITY_PRESETS[quality].fire },
                { l: "Fumée", v: QUALITY_PRESETS[quality].smoke },
                { l: "Vent", v: QUALITY_PRESETS[quality].wind },
              ].map((x) => (
                <div key={x.l} className="py-2 rounded-xl" style={{ background: C.fill }}>
                  <div className="text-[14px] font-semibold tabular" style={{ color: C.text }}>{x.v.toLocaleString("fr-FR")}</div>
                  <div className="text-[10px]" style={{ color: C.text4 }}>{x.l}</div>
                </div>
              ))}
            </div>
            <Row label="Dôme de couverture des passerelles">
              <span className="text-[11px]" style={{ color: C.text3 }}>{QUALITY_PRESETS[quality].dome ? "Affiché" : "Masqué"}</span>
            </Row>
            <Row label="Compteur d'images par seconde" hint="Affiché dans la pilule de contrôle de la carte">
              <Toggle label="Afficher les FPS" checked={showFps} onChange={setShowFps} />
            </Row>
            <Row label="Animations réduites" hint="Préférence système prefers-reduced-motion">
              <span className="text-[11px]" style={{ color: reduced ? C.fire : C.text3 }}>{reduced ? "Actives" : "Non demandées"}</span>
            </Row>
          </Card>
        </div>
      </div>

      {/* Barre d'actions collante */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-3" style={{ borderTop: `1px solid ${C.line}`, background: "rgba(0,0,0,0.35)" }}>
        <span className="text-[11px] flex items-center gap-1.5" style={{ color: dirty ? C.fire : C.text4 }}>
          {dirty
            ? <><span className="w-1.5 h-1.5 rounded-full" style={{ background: C.fire }} />Modifications non enregistrées</>
            : <><Check className="w-3.5 h-3.5" />Paramètres à jour</>}
        </span>
        <div className="flex-1" />
        <button
          onClick={restoreDefaults}
          className="h-9 px-4 rounded-full text-[12px] font-medium flex items-center gap-2 spring-hover"
          style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${C.line}`, color: C.text2 }}
        >
          <RotateCcw className="w-3.5 h-3.5" /> Restaurer par défaut
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="h-9 px-5 rounded-full text-[12px] font-semibold spring-hover disabled:opacity-70"
          style={{ background: C.fire, color: "#000000" }}
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  )
}
