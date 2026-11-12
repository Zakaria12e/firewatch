import { Flame, MapPin, Navigation, Clock, TriangleAlert, CheckCircle } from "lucide-react"
import type { Incident, AlertLevelPayload } from "@/types"

const LEVEL_LABEL: Record<string, string> = {
  veille:        "Veille",
  vigilance:     "Vigilance",
  suspicion:     "Suspicion",
  "pré-alerte":  "Pré-alerte",
  feu_confirmé:  "FEU CONFIRMÉ",
  maîtrisé:      "Maîtrisé",
}

const LEVEL_BORDER: Record<string, string> = {
  veille:        "border-zinc-700",
  vigilance:     "border-yellow-500/50",
  suspicion:     "border-orange-500/50",
  "pré-alerte":  "border-orange-600/60",
  feu_confirmé:  "border-red-500",
  maîtrisé:      "border-green-500/50",
}

const LEVEL_TEXT: Record<string, string> = {
  veille:        "text-muted-foreground",
  vigilance:     "text-yellow-400",
  suspicion:     "text-orange-400",
  "pré-alerte":  "text-orange-500",
  feu_confirmé:  "text-red-500",
  maîtrisé:      "text-green-500",
}

function formatEta(etaMin: number): string {
  if (etaMin < 60) return `${etaMin} min`
  return `${Math.round(etaMin / 60)} h ${etaMin % 60} min`
}

function headingLabel(deg?: number): string {
  if (deg === undefined) return "—"
  const dirs = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"]
  return dirs[Math.round(deg / 45) % 8]
}

interface Props {
  incident: Incident | null
  alertLevel: AlertLevelPayload
  sendCommand: (type: string, payload?: Record<string, unknown>) => void
}

export function IncidentPanel({ incident, alertLevel, sendCommand }: Props) {
  const level = alertLevel.level

  if (!incident && level === "veille") {
    return (
      <div className="w-64 border-l border-border flex flex-col items-center justify-center gap-3 text-muted-foreground p-4">
        <CheckCircle className="w-8 h-8 opacity-30" />
        <div className="text-sm text-center">Surveillance en cours</div>
        <div className="text-xs opacity-40 text-center">Aucune anomalie</div>
        <button
          onClick={() => sendCommand("fire_start", { lat: 35.135, lon: -5.215 })}
          className="mt-4 px-3 py-1.5 text-xs bg-orange-600/20 border border-orange-500/30 text-orange-400 rounded hover:bg-orange-600/30 transition-colors"
        >
          Test : allumer un feu
        </button>
      </div>
    )
  }

  return (
    <div className={`w-64 border-l ${LEVEL_BORDER[level] ?? "border-border"} flex flex-col overflow-hidden`}>
      {/* En-tête niveau */}
      <div className="p-3 border-b border-border">
        <div className={`flex items-center gap-2 font-mono font-bold ${LEVEL_TEXT[level] ?? "text-foreground"}`}>
          <Flame className="w-4 h-4 shrink-0" />
          <span className="text-sm">{LEVEL_LABEL[level] ?? level}</span>
        </div>
        {alertLevel.score > 0 && (
          <div className="mt-2">
            <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
              <span>Score de confiance</span>
              <span className="font-mono">{alertLevel.score}%</span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-orange-500 rounded-full transition-all duration-500"
                style={{ width: `${alertLevel.score}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 text-xs">
        {incident && (
          <>
            {/* Position */}
            {incident.position && (
              <div>
                <div className="flex items-center gap-1 text-muted-foreground mb-1">
                  <MapPin className="w-3 h-3" />
                  <span>Position estimée</span>
                </div>
                <div className="font-mono text-foreground pl-4">
                  {incident.position.lat.toFixed(4)}, {incident.position.lon.toFixed(4)}
                </div>
              </div>
            )}

            {/* Propagation */}
            {(incident.heading !== undefined || incident.rosMPerMin) && (
              <div>
                <div className="flex items-center gap-1 text-muted-foreground mb-1">
                  <Navigation className="w-3 h-3" />
                  <span>Propagation</span>
                </div>
                <div className="pl-4 flex flex-col gap-0.5 text-foreground font-mono">
                  {incident.heading !== undefined && (
                    <span>Direction : {headingLabel(incident.heading)} ({incident.heading.toFixed(0)}°)</span>
                  )}
                  {incident.rosMPerMin && (
                    <span>Vitesse : {incident.rosMPerMin} m/min</span>
                  )}
                  {incident.areaHa && (
                    <span>Surface : {incident.areaHa} ha</span>
                  )}
                </div>
              </div>
            )}

            {/* Villages menacés */}
            {incident.threatenedPlaces && incident.threatenedPlaces.length > 0 && (
              <div>
                <div className="flex items-center gap-1 text-red-500 mb-1">
                  <TriangleAlert className="w-3 h-3" />
                  <span className="font-semibold">Villages menacés</span>
                </div>
                {incident.threatenedPlaces.map((p) => (
                  <div key={p.name} className="pl-4 flex justify-between text-foreground">
                    <span>{p.name}</span>
                    <span className="font-mono text-orange-400 ml-2">
                      {formatEta(p.eta)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Nœuds suspects */}
            {incident.suspects && incident.suspects.length > 0 && (
              <div>
                <div className="text-muted-foreground mb-1">Capteurs déclencheurs</div>
                <div className="pl-4 flex flex-wrap gap-1">
                  {incident.suspects.map((id) => (
                    <span
                      key={id}
                      className="px-1.5 py-0.5 bg-orange-500/10 border border-orange-500/20 text-orange-400 rounded font-mono"
                    >
                      {id}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Horodatage */}
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>
                {incident.status === "actif"
                  ? `Actif depuis ${Math.round((Date.now() - incident.startedAt) / 60000)} min`
                  : `Maîtrisé – ${incident.reason ?? ""}`}
              </span>
            </div>
          </>
        )}

        {/* Niveau vigilance sans incident */}
        {!incident && level !== "veille" && (
          <div className={`text-sm ${LEVEL_TEXT[level]}`}>
            {LEVEL_LABEL[level]}
          </div>
        )}
      </div>

      {/* Actions */}
      {incident?.status === "actif" && (
        <div className="p-3 border-t border-border flex flex-col gap-2">
          <button
            onClick={() => sendCommand("reset")}
            className="w-full px-3 py-1.5 text-xs bg-zinc-700/50 border border-zinc-600 text-zinc-300 rounded hover:bg-zinc-700 transition-colors"
          >
            Réinitialiser
          </button>
        </div>
      )}
    </div>
  )
}
