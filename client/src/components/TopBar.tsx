import { Wifi, WifiOff, Flame, Bell, BellOff, Wind } from "lucide-react"
import type { FireWatchState, AlertLevelPayload } from "@/types"

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

const MODE_LABEL: Record<string, string> = {
  reel:      "Réel",
  manuel:    "Manuel",
  prevision: "Prévis.",
}

const MODE_COLOR: Record<string, string> = {
  reel:      "#30d158",
  manuel:    "#ffd60a",
  prevision: "#64d2ff",
}

interface Props {
  state: FireWatchState
  alertLevel: AlertLevelPayload
  sirenOn: boolean
  onToggleSiren: () => void
}

export function TopBar({ state, alertLevel, sirenOn, onToggleSiren }: Props) {
  const online  = state.nodes.filter((n) => n.online).length
  const total   = state.nodes.length
  const level   = alertLevel.level
  const mode    = state.weatherMode ?? "reel"
  const detWind = alertLevel.wind
  const weather = state.weather
  const windSpeed = detWind?.speed ?? weather?.wind_speed
  const levelColor = LEVEL_COLOR[level] ?? "#ffffff"
  const isAlert = level === "feu_confirmé"

  return (
    /* Conteneur plein-écran pointer-events-none pour centrer */
    <div className="fixed top-3 inset-x-0 z-50 flex justify-center pointer-events-none">
      <div
        className="glass anim-down pointer-events-auto h-11 flex items-center px-4"
        style={{
          borderRadius: 22,
          width: "min(780px, calc(100vw - 24px))",
          gap: 0,
        }}
      >
        {/* ── Colonne gauche ── */}
        <div className="flex-1 flex items-center gap-3 min-w-0">
          {/* Sim */}
          <div className="flex items-center gap-1.5 shrink-0">
            {state.simulatorConnected
              ? <Wifi  className="w-3 h-3" style={{ color: "#30d158" }} />
              : <WifiOff className="w-3 h-3" style={{ color: "rgba(235,235,245,0.25)" }} />}
            <span className="text-[11px] tabular"
              style={{ color: state.simulatorConnected ? "#30d158" : "rgba(235,235,245,0.25)" }}>
              {state.simulatorConnected ? "Sim" : "Offline"}
            </span>
          </div>

          <div className="w-px h-3.5 shrink-0" style={{ background: "rgba(255,255,255,0.10)" }} />

          {/* Appareils */}
          <span className="text-[11px] tabular shrink-0" style={{ color: "rgba(235,235,245,0.45)" }}>
            {online}
            <span style={{ color: "rgba(235,235,245,0.22)" }}>/{total}</span>
          </span>

          <div className="w-px h-3.5 shrink-0" style={{ background: "rgba(255,255,255,0.10)" }} />

          {/* Niveau d'alerte */}
          <div className="flex items-center gap-1.5 min-w-0 shrink-0">
            <Flame className={`w-3.5 h-3.5 shrink-0 ${isAlert ? "animate-pulse" : ""}`} style={{ color: levelColor }} />
            <span
              className={`text-[11px] font-semibold tabular truncate ${isAlert ? "animate-pulse" : ""}`}
              style={{ color: levelColor, letterSpacing: "-0.3px" }}
            >
              {LEVEL_LABEL[level] ?? level}
            </span>
            {alertLevel.score > 0 && (
              <span className="text-[10px] tabular shrink-0" style={{ color: "rgba(235,235,245,0.30)" }}>
                {alertLevel.score}%
              </span>
            )}
          </div>
        </div>

        {/* ── Centre : Logo ── */}
        <div className="shrink-0 px-5 flex items-center justify-center">
          <span
            className="text-[13px] font-bold uppercase select-none tracking-tight"
            style={{ color: "#ff9f0a", letterSpacing: "-0.3px" }}
          >
            FireWatch
          </span>
        </div>

        {/* ── Colonne droite ── */}
        <div className="flex-1 flex items-center justify-end gap-2.5">
          {/* Météo */}
          {(weather || detWind) && (
            <div className="flex items-center gap-1.5 shrink-0">
              {weather && (
                <span className="text-[11px] tabular" style={{ color: "rgba(235,235,245,0.45)" }}>
                  {weather.temp?.toFixed(0)}°
                  <span className="mx-0.5 opacity-30">·</span>
                  {weather.hum?.toFixed(0)}%
                </span>
              )}
              {windSpeed !== undefined && (
                <div className="flex items-center gap-1">
                  <Wind className="w-3 h-3" style={{ color: "rgba(235,235,245,0.3)" }} />
                  <span className="text-[11px] tabular" style={{ color: detWind ? "#64d2ff" : "rgba(235,235,245,0.45)" }}>
                    {windSpeed.toFixed(1)} m/s
                  </span>
                </div>
              )}
              {/* Badge mode */}
              <span
                className="px-1.5 py-0.5 text-[8px] font-bold uppercase rounded-full"
                style={{
                  color: MODE_COLOR[mode] ?? "#fff",
                  background: `${MODE_COLOR[mode] ?? "#fff"}16`,
                  border: `1px solid ${MODE_COLOR[mode] ?? "#fff"}28`,
                  letterSpacing: "0.07em",
                }}
              >
                {MODE_LABEL[mode]}
              </span>
            </div>
          )}

          {/* Sirène */}
          <button
            onClick={onToggleSiren}
            className="w-7 h-7 flex items-center justify-center rounded-full spring-hover shrink-0"
            style={{
              background: sirenOn ? "rgba(255,59,48,0.18)" : "rgba(255,255,255,0.06)",
              border: `1px solid ${sirenOn ? "rgba(255,59,48,0.35)" : "rgba(255,255,255,0.08)"}`,
            }}
            title={sirenOn ? "Sirène ON" : "Sirène auto"}
          >
            {sirenOn
              ? <Bell    className="w-3.5 h-3.5 animate-pulse" style={{ color: "#ff3b30" }} />
              : <BellOff className="w-3.5 h-3.5" style={{ color: "rgba(235,235,245,0.35)" }} />}
          </button>
        </div>
      </div>
    </div>
  )
}
