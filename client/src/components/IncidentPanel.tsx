import { Flame, MapPin, Navigation, Clock, TriangleAlert, Shield, Eye, CheckCircle } from "lucide-react"
import type { Incident, AlertLevelPayload } from "@/types"

const LEVEL_LABEL: Record<string, string> = {
  veille:        "Veille",
  vigilance:     "Vigilance",
  suspicion:     "Suspicion",
  "pré-alerte":  "Pré-alerte",
  feu_confirmé:  "Feu confirmé",
  maîtrisé:      "Maîtrisé",
}

const LEVEL_COLOR: Record<string, string> = {
  veille:        "rgba(235,235,245,0.38)",
  vigilance:     "#ffd60a",
  suspicion:     "#ff9f0a",
  "pré-alerte":  "#ff6b00",
  feu_confirmé:  "#ff3b30",
  maîtrisé:      "#30d158",
}

const DETAIL_LEVELS = new Set(["pré-alerte", "feu_confirmé", "maîtrisé"])

function formatEta(etaMin: number): string {
  if (etaMin < 60) return `${etaMin} min`
  return `${Math.round(etaMin / 60)} h ${etaMin % 60} min`
}

function headingLabel(deg?: number): string {
  if (deg === undefined) return "—"
  const dirs = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"]
  return dirs[Math.round(deg / 45) % 8]
}

/** Jauge circulaire SVG pour le score de confiance */
function CircularGauge({ value, color }: { value: number; color: string }) {
  const r = 22
  const circ = 2 * Math.PI * r
  const filled = (Math.min(value, 100) / 100) * circ

  return (
    <div className="relative w-16 h-16 flex items-center justify-center">
      <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
        <circle
          cx="32" cy="32" r={r} fill="none"
          stroke={color} strokeWidth="4"
          strokeDasharray={`${filled} ${circ - filled}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.6s cubic-bezier(0.34,1.56,0.64,1)" }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-[13px] font-semibold tabular leading-none" style={{ color }}>{value}</div>
        <div className="text-[8px] text-white/30 leading-none mt-0.5">%</div>
      </div>
    </div>
  )
}

/** Ligne de temps verticale */
function Timeline({ events }: { events: { type: string; at: number }[] }) {
  if (!events.length) return null
  return (
    <div className="relative ml-1">
      {/* Trait vertical */}
      <div className="absolute left-[7px] top-2 bottom-2 w-px bg-white/10" />
      <div className="flex flex-col gap-2">
        {events.map((ev, i) => {
          const color = LEVEL_COLOR[ev.type] ?? "rgba(235,235,245,0.4)"
          const t = new Date(ev.at)
          const time = `${t.getHours().toString().padStart(2, "0")}:${t.getMinutes().toString().padStart(2, "0")}:${t.getSeconds().toString().padStart(2, "0")}`
          return (
            <div key={i} className="flex items-center gap-2.5">
              <div className="w-3.5 h-3.5 rounded-full border-2 shrink-0 relative z-10"
                style={{ background: `${color}1a`, borderColor: color }} />
              <div className="flex-1 flex justify-between items-baseline">
                <span className="text-[10px] font-medium" style={{ color }}>
                  {LEVEL_LABEL[ev.type] ?? ev.type}
                </span>
                <span className="text-[9px] tabular" style={{ color: "rgba(235,235,245,0.3)" }}>{time}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface Props {
  incident: Incident | null
  alertLevel: AlertLevelPayload
  sendCommand: (type: string, payload?: Record<string, unknown>) => void
}

export function IncidentPanel({ incident, alertLevel, sendCommand }: Props) {
  const level = alertLevel.level
  const showDetails = DETAIL_LEVELS.has(level)
  const levelColor = LEVEL_COLOR[level] ?? "#ffffff"
  const isAlert = level === "feu_confirmé"
  const isMaitrised = level === "maîtrisé"

  return (
    <div
      className="glass anim-right fixed right-3 top-16 bottom-3 z-30 flex flex-col overflow-hidden"
      style={{
        width: 272,
        borderRadius: 18,
        /* Spring d'entrée à pré-alerte+ */
        transition: "box-shadow 0.4s ease",
        boxShadow: isAlert
          ? `0 4px 32px rgba(255,59,48,0.25), 0 0 0 1px rgba(255,59,48,0.3)`
          : isMaitrised
          ? `0 4px 32px rgba(48,209,88,0.15)`
          : "0 4px 32px rgba(0,0,0,0.30)",
      }}
    >
      {/* En-tête niveau – gradient ember→red à feu_confirmé */}
      <div
        className="shrink-0 px-4 pt-3.5 pb-3"
        style={{
          background: isAlert
            ? "linear-gradient(160deg, rgba(107,37,16,0.6) 0%, rgba(255,59,48,0.12) 100%)"
            : isMaitrised
            ? "rgba(48,209,88,0.06)"
            : "transparent",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        {/* Niveau + score */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Flame
              className={`w-4 h-4 shrink-0 ${isAlert ? "animate-pulse" : ""}`}
              style={{ color: levelColor }}
            />
            <span
              className={`text-[13px] font-semibold leading-none ${isAlert ? "animate-pulse" : ""}`}
              style={{ color: levelColor, letterSpacing: "-0.374px" }}
            >
              {LEVEL_LABEL[level] ?? level}
            </span>
          </div>

          {alertLevel.score > 0 && (
            <CircularGauge value={alertLevel.score} color={levelColor} />
          )}
        </div>

        {/* Indice de risque météo */}
        <div className="flex items-center gap-1.5 mt-2">
          <Eye className="w-3 h-3" style={{ color: "rgba(235,235,245,0.4)" }} />
          <span className="text-[10px]" style={{ color: "rgba(235,235,245,0.4)" }}>Risque météo</span>
          <span
            className="text-[10px] font-semibold tabular ml-auto"
            style={{
              color: alertLevel.riskIndex.value >= 75 ? "#ff3b30"
                   : alertLevel.riskIndex.value >= 50 ? "#ff9f0a"
                   : "rgba(235,235,245,0.55)",
            }}
          >
            {alertLevel.riskIndex.value}%
          </span>
        </div>
      </div>

      {/* Corps scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">

        {/* Veille – état nominal */}
        {level === "veille" && !incident && (
          <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
            <Shield className="w-10 h-10 opacity-15" style={{ color: "rgba(235,235,245,0.6)" }} />
            <div>
              <div className="text-[13px] font-medium text-white/60">Surveillance active</div>
              <div className="text-[11px] text-white/30 mt-1">Aucune anomalie détectée</div>
            </div>
            <button
              onClick={() => sendCommand("fire_start", { lat: 35.135, lon: -5.215 })}
              className="mt-2 px-4 py-2 text-[11px] font-medium rounded-full transition-all"
              style={{
                background: "rgba(255,90,31,0.14)",
                border: "1px solid rgba(255,90,31,0.3)",
                color: "#ff9f0a",
              }}
            >
              Test : allumer un feu
            </button>
          </div>
        )}

        {/* Vigilance / Suspicion */}
        {!showDetails && level !== "veille" && (
          <div className="text-[12px] font-medium leading-relaxed" style={{ color: levelColor }}>
            {level === "vigilance"
              ? "Conditions météo défavorables — surveillance renforcée."
              : "Anomalie détectée — en cours d'évaluation."}
          </div>
        )}

        {/* Capteurs suspects (suspicion) */}
        {level === "suspicion" && incident?.suspects && incident.suspects.length > 0 && (
          <div>
            <div className="text-[10px] text-white/40 mb-1.5">Capteurs suspects</div>
            <div className="flex flex-wrap gap-1">
              {incident.suspects.map((id) => (
                <span
                  key={id}
                  className="px-1.5 py-0.5 text-[10px] font-mono rounded-md"
                  style={{ background: "rgba(255,159,10,0.12)", border: "1px solid rgba(255,159,10,0.2)", color: "#ff9f0a" }}
                >
                  {id}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Détails complets pré-alerte+ */}
        {showDetails && incident && (
          <>
            {/* Position */}
            {incident.position && (
              <div>
                <div className="flex items-center gap-1.5 text-white/40 mb-1">
                  <MapPin className="w-3 h-3" />
                  <span className="text-[10px]">Position estimée</span>
                  {incident.position.uncertainty_m && (
                    <span className="text-[9px] tabular ml-auto" style={{ color: "rgba(235,235,245,0.3)" }}>
                      ±{incident.position.uncertainty_m} m
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-mono text-white/70 pl-4 tabular">
                  {incident.position.lat.toFixed(4)}, {incident.position.lon.toFixed(4)}
                </div>
              </div>
            )}

            {/* Propagation */}
            {(incident.heading !== undefined || incident.rosMPerMin !== undefined) && (
              <div>
                <div className="flex items-center gap-1.5 text-white/40 mb-1">
                  <Navigation className="w-3 h-3" />
                  <span className="text-[10px]">Propagation</span>
                </div>
                <div className="pl-4 flex flex-col gap-0.5">
                  {incident.heading !== undefined && (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-white/50">Direction</span>
                      <span className="font-mono tabular text-white/80">
                        {headingLabel(incident.heading)} ({incident.heading.toFixed(0)}°)
                      </span>
                    </div>
                  )}
                  {incident.rosMPerMin !== undefined && (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-white/50">Vitesse</span>
                      <span className="font-mono tabular text-white/80">{incident.rosMPerMin} m/min</span>
                    </div>
                  )}
                  {incident.areaHa !== undefined && (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-white/50">Surface</span>
                      <span className="font-mono tabular text-white/80">{incident.areaHa} ha</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Villages menacés */}
            {incident.threatenedPlaces && incident.threatenedPlaces.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5" style={{ color: "#ff3b30" }}>
                  <TriangleAlert className="w-3 h-3" />
                  <span className="text-[10px] font-semibold">Villages menacés</span>
                </div>
                {incident.threatenedPlaces.map((p) => (
                  <div key={p.name} className="flex justify-between text-[11px] pl-4 py-0.5">
                    <span className="text-white/70">{p.name}</span>
                    <span className="font-mono tabular" style={{ color: "#ff9f0a" }}>{formatEta(p.eta)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Capteurs déclencheurs */}
            {incident.suspects && incident.suspects.length > 0 && (
              <div>
                <div className="text-[10px] text-white/40 mb-1.5">Capteurs déclencheurs</div>
                <div className="flex flex-wrap gap-1">
                  {incident.suspects.map((id) => (
                    <span
                      key={id}
                      className="px-1.5 py-0.5 text-[10px] font-mono rounded-md"
                      style={{ background: "rgba(255,90,31,0.10)", border: "1px solid rgba(255,90,31,0.2)", color: "#ff9f0a" }}
                    >
                      {id}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Durée */}
            <div className="flex items-center gap-1.5" style={{ color: "rgba(235,235,245,0.4)" }}>
              <Clock className="w-3 h-3" />
              <span className="text-[11px]">
                {incident.status === "actif"
                  ? `Actif depuis ${Math.round((Date.now() - incident.startedAt) / 60000)} min`
                  : `Maîtrisé – ${incident.reason ?? ""}`}
              </span>
            </div>

            {/* Chronologie */}
            {incident.timeline && incident.timeline.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-white/40 mb-2">
                  <CheckCircle className="w-3 h-3" />
                  <span className="text-[10px]">Chronologie</span>
                </div>
                <Timeline events={incident.timeline} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Actions */}
      {incident?.status === "actif" && showDetails && (
        <div className="shrink-0 px-3 pb-3 pt-2 flex flex-col gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <button
            onClick={() => sendCommand("reset")}
            className="w-full py-2.5 text-[12px] font-semibold rounded-full transition-all"
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "rgba(235,235,245,0.8)",
            }}
          >
            Réinitialiser
          </button>
          {level === "feu_confirmé" && (
            <button
              onClick={() => sendCommand("acknowledge")}
              className="w-full py-2.5 text-[12px] font-semibold rounded-full transition-all"
              style={{
                background: "rgba(255,90,31,0.18)",
                border: "1px solid rgba(255,90,31,0.35)",
                color: "#ff9f0a",
              }}
            >
              Acquitter
            </button>
          )}
        </div>
      )}
    </div>
  )
}
