import { Wifi, WifiOff, Flame, Bell, BellOff } from "lucide-react"
import type { FireWatchState, AlertLevelPayload } from "@/types"

const LEVEL_LABEL: Record<string, string> = {
  veille: "Veille",
  vigilance: "Vigilance",
  suspicion: "Suspicion",
  "pré-alerte": "Pré-alerte",
  feu_confirmé: "FEU CONFIRMÉ",
  maîtrisé: "Maîtrisé",
}

const LEVEL_CLASS: Record<string, string> = {
  veille: "text-muted-foreground",
  vigilance: "text-yellow-400",
  suspicion: "text-orange-400",
  "pré-alerte": "text-orange-500",
  feu_confirmé: "text-red-500 font-bold animate-pulse",
  maîtrisé: "text-green-500",
}

interface Props {
  state: FireWatchState
  alertLevel: AlertLevelPayload
  sirenOn: boolean
  onToggleSiren: () => void
}

export function TopBar({ state, alertLevel, sirenOn, onToggleSiren }: Props) {
  const online = state.nodes.filter((n) => n.online).length
  const total = state.nodes.length

  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-12 bg-black/90 border-b border-border flex items-center px-4 gap-5 backdrop-blur">
      <span className="text-orange-500 font-bold tracking-widest text-sm uppercase select-none">
        FireWatch
      </span>

      <div className="flex items-center gap-1 text-xs">
        {state.simulatorConnected ? (
          <Wifi className="w-3 h-3 text-green-500" />
        ) : (
          <WifiOff className="w-3 h-3 text-zinc-500" />
        )}
        <span className={state.simulatorConnected ? "text-green-500" : "text-zinc-500"}>
          {state.simulatorConnected ? "Sim connecté" : "Sim hors ligne"}
        </span>
      </div>

      <div className="text-xs text-muted-foreground font-mono">
        {online}/{total} appareils
      </div>

      <div
        className={`flex items-center gap-1 text-sm font-mono ${
          LEVEL_CLASS[alertLevel.level] ?? "text-foreground"
        }`}
      >
        <Flame className="w-4 h-4 shrink-0" />
        {LEVEL_LABEL[alertLevel.level] ?? alertLevel.level}
        {alertLevel.score > 0 && (
          <span className="ml-1 opacity-60 text-xs">({alertLevel.score}%)</span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-5">
        {state.weather && (
          <div className="text-xs text-muted-foreground font-mono">
            {state.weather.temp?.toFixed(0)}°C&nbsp;·&nbsp;
            {state.weather.hum?.toFixed(0)}%HR&nbsp;·&nbsp;
            {state.weather.wind_speed?.toFixed(1)}m/s&nbsp;@&nbsp;
            {state.weather.wind_dir?.toFixed(0)}°
          </div>
        )}

        <button
          onClick={onToggleSiren}
          className={`p-1 rounded transition-colors ${
            sirenOn
              ? "text-red-500 hover:text-red-400"
              : "text-muted-foreground hover:text-foreground"
          }`}
          title={sirenOn ? "Sirène forcée ON – cliquer pour désactiver" : "Sirène auto"}
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
