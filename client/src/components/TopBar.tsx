import { Flame, Bell, BellOff, Wind } from "lucide-react"
import type { FireWatchState, AlertLevelPayload } from "@/types"
import { C, alpha, levelColor, levelLabel } from "@/lib/palette"

const MODE_LABEL: Record<string, string> = {
  reel:      "Réel",
  manuel:    "Manuel",
  prevision: "Prévision",
}

interface Props {
  state: FireWatchState
  alertLevel: AlertLevelPayload
  sirenOn: boolean
  onToggleSiren: () => void
}

const Divider = () => <div className="w-px h-3.5 shrink-0" style={{ background: C.line }} />

export function TopBar({ state, alertLevel, sirenOn, onToggleSiren }: Props) {
  const online  = state.nodes.filter((n) => n.online).length
  const total   = state.nodes.length
  const level   = alertLevel.level
  const mode    = state.weatherMode ?? "reel"
  const detWind = alertLevel.wind
  const weather = state.weather
  const windSpeed = detWind?.speed ?? weather?.wind_speed
  const color   = levelColor(level)
  const isAlert = level === "feu_confirmé"
  const sim     = state.simulatorConnected

  return (
    <div className="fixed top-3 inset-x-0 z-50 flex justify-center pointer-events-none">
      <div
        className="glass anim-down pointer-events-auto h-11 flex items-center px-4"
        style={{ borderRadius: 22, width: "min(780px, calc(100vw - 24px))" }}
      >
        {/* ── Colonne gauche ── */}
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 shrink-0" title={sim ? "Simulateur connecté" : "Simulateur déconnecté"}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: sim ? C.ok : C.gray }} />
            <span className="text-[11px]" style={{ color: sim ? C.text2 : C.text4 }}>{sim ? "Sim" : "Hors ligne"}</span>
          </div>

          <Divider />

          <span className="text-[11px] tabular shrink-0" style={{ color: C.text2 }} title="Appareils en ligne">
            {online}<span style={{ color: C.text4 }}>/{total}</span>
          </span>

          <Divider />

          <div className="flex items-center gap-1.5 min-w-0 shrink-0">
            <Flame className={`w-3.5 h-3.5 shrink-0 ${isAlert ? "animate-pulse" : ""}`} style={{ color }} />
            <span className="text-[11px] font-semibold truncate" style={{ color, letterSpacing: "-0.3px" }}>
              {levelLabel(level)}
            </span>
            {alertLevel.score > 0 && (
              <span className="text-[10px] tabular shrink-0" style={{ color: C.text4 }}>{alertLevel.score}%</span>
            )}
          </div>
        </div>

        {/* ── Centre : logo ── */}
        <div className="shrink-0 px-5 flex items-center justify-center">
          <span className="text-[13px] font-bold uppercase select-none" style={{ color: C.fire, letterSpacing: "-0.3px" }}>
            FireWatch
          </span>
        </div>

        {/* ── Colonne droite ── */}
        <div className="flex-1 flex items-center justify-end gap-2.5">
          {(weather || detWind) && (
            <div className="flex items-center gap-1.5 shrink-0">
              {weather && (
                <span className="text-[11px] tabular" style={{ color: C.text2 }}>
                  {weather.temp?.toFixed(0)}°
                  <span className="mx-0.5" style={{ color: C.text4 }}>·</span>
                  {weather.hum?.toFixed(0)}%
                </span>
              )}
              {windSpeed !== undefined && (
                <div className="flex items-center gap-1" title="Vent mesuré">
                  <Wind className="w-3 h-3" style={{ color: C.text3 }} />
                  <span className="text-[11px] tabular" style={{ color: C.text2 }}>{windSpeed.toFixed(1)} m/s</span>
                </div>
              )}
              <span
                className="px-1.5 py-0.5 text-[8px] font-bold uppercase rounded-full"
                style={{ color: C.text2, background: C.fill, border: `1px solid ${C.line}`, letterSpacing: "0.07em" }}
                title="Mode météo"
              >
                {MODE_LABEL[mode] ?? mode}
              </span>
            </div>
          )}

          <button
            onClick={onToggleSiren}
            className="w-7 h-7 flex items-center justify-center rounded-full spring-hover shrink-0"
            style={{
              background: sirenOn ? alpha(C.red, 0.2) : C.fill,
              border: `1px solid ${sirenOn ? alpha(C.red, 0.45) : C.line}`,
            }}
            title={sirenOn ? "Sirènes forcées : arrêter" : "Forcer les sirènes"}
          >
            {sirenOn
              ? <Bell    className="w-3.5 h-3.5 animate-pulse" style={{ color: C.red }} />
              : <BellOff className="w-3.5 h-3.5" style={{ color: C.text3 }} />}
          </button>
        </div>
      </div>
    </div>
  )
}
