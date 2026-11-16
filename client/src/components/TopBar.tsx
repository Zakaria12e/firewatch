import { Wifi, WifiOff, Flame, Bell, BellOff, Wind } from "lucide-react"
import type { FireWatchState, AlertLevelPayload } from "@/types"

const LEVEL_LABEL: Record<string, string> = {
  veille:        "Veille",
  vigilance:     "Vigilance",
  suspicion:     "Suspicion",
  "pré-alerte":  "Pré-alerte",
  feu_confirmé:  "FEU CONFIRMÉ",
  maîtrisé:      "Maîtrisé",
}

const LEVEL_CLASS: Record<string, string> = {
  veille:        "text-muted-foreground",
  vigilance:     "text-yellow-400",
  suspicion:     "text-orange-400",
  "pré-alerte":  "text-orange-500",
  feu_confirmé:  "text-red-500 font-bold animate-pulse",
  maîtrisé:      "text-green-500",
}

const MODE_LABEL: Record<string, string> = {
  reel:      "Réel",
  manuel:    "Manuel",
  prevision: "Prévision",
}

const MODE_CLASS: Record<string, string> = {
  reel:      "text-green-400",
  manuel:    "text-yellow-400",
  prevision: "text-cyan-400",
}

interface Props {
  state: FireWatchState
  alertLevel: AlertLevelPayload
  sirenOn: boolean
  onToggleSiren: () => void
}

export function TopBar({ state, alertLevel, sirenOn, onToggleSiren }: Props) {
  const online = state.nodes.filter((n) => n.online).length
  const total  = state.nodes.length

  // Vent : priorité au vent mesuré par les capteurs (vent de détection)
  const detWind = alertLevel.wind
  const weather = state.weather
  const windSpeed = detWind?.speed ?? weather?.wind_speed
  const windFrom  = detWind?.from  ?? weather?.wind_dir
  const mode = state.weatherMode ?? "reel"

  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-12 bg-black/90 border-b border-border flex items-center px-4 gap-5 backdrop-blur">
      {/* Logo */}
      <span className="text-orange-500 font-bold tracking-widest text-sm uppercase select-none">
        FireWatch
      </span>

      {/* Connexion simulateur */}
      <div className="flex items-center gap-1 text-xs" title="État de la connexion avec le simulateur Python">
        {state.simulatorConnected ? (
          <Wifi className="w-3 h-3 text-green-500" />
        ) : (
          <WifiOff className="w-3 h-3 text-zinc-500" />
        )}
        <span className={state.simulatorConnected ? "text-green-500" : "text-zinc-500"}>
          {state.simulatorConnected ? "Sim connecté" : "Sim hors ligne"}
        </span>
      </div>

      {/* Appareils */}
      <div className="text-xs text-muted-foreground font-mono" title="Appareils en ligne / total">
        {online}/{total} appareils
      </div>

      {/* Niveau d'alerte */}
      <div
        className={`flex items-center gap-1 text-sm font-mono ${LEVEL_CLASS[alertLevel.level] ?? "text-foreground"}`}
        title={`Niveau d'alerte – score ${alertLevel.score}%`}
      >
        <Flame className="w-4 h-4 shrink-0" />
        {LEVEL_LABEL[alertLevel.level] ?? alertLevel.level}
        {alertLevel.score > 0 && (
          <span className="ml-1 opacity-60 text-xs">({alertLevel.score}%)</span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-5">
        {/* Météo : temp + humidité depuis state.weather, vent depuis capteurs */}
        {(weather || detWind) && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
            {weather && (
              <span>
                {weather.temp?.toFixed(0)}°C&nbsp;·&nbsp;{weather.hum?.toFixed(0)}%HR
              </span>
            )}
            {(windSpeed !== undefined || windFrom !== undefined) && (
              <>
                <span className="opacity-30">·</span>
                <Wind className="w-3 h-3" />
                <span
                  title="Vent mesuré par les capteurs (source de vérité pour la détection)"
                  className={detWind ? "text-cyan-400" : ""}
                >
                  {windSpeed?.toFixed(1) ?? "—"}m/s&nbsp;@&nbsp;{windFrom?.toFixed(0) ?? "—"}°
                </span>
              </>
            )}
            {/* Mode météo actif */}
            <span
              className={`ml-1 px-1 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${MODE_CLASS[mode]} border-current/30`}
              title={`Mode météo : ${MODE_LABEL[mode]}`}
            >
              {MODE_LABEL[mode]}
            </span>
          </div>
        )}

        {/* Bouton sirène */}
        <button
          onClick={onToggleSiren}
          className={`p-1 rounded transition-colors ${
            sirenOn ? "text-red-500 hover:text-red-400" : "text-muted-foreground hover:text-foreground"
          }`}
          title={sirenOn ? "Sirène forcée ON – cliquer pour désactiver" : "Sirène auto (inactif)"}
        >
          {sirenOn ? (
            <Bell className="w-4 h-4 animate-pulse" />
          ) : (
            <BellOff className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  )
}
