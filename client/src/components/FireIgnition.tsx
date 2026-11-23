/**
 * Départ de feu par glisser-déposer : point de départ en attente (cercle d'allumage drapé
 * sur le relief + balise 3D + compte à rebours de 3 s), déplaçable ou annulable, puis
 * ordre fire_start / fire_line au simulateur. Menu contextuel de la carte (clic droit).
 *
 * L'aperçu ne montre que l'endroit où le feu va prendre : jamais les capteurs qui le
 * détecteront (règle d'or : la détection reste l'affaire du serveur).
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { Marker } from "react-map-gl/maplibre"
import { Droplets, Flame, X, Ban } from "lucide-react"
import type { DeviceKind } from "@/types"
import { C, alpha, KIND_META } from "@/lib/palette"
import { IGNITION_DELAY_MS, FIRE_SIZE_LABEL, fireTool } from "@/lib/fireTool"
import { anchorOf, lineLengthM, type MapMenuState, type PendingFire } from "@/lib/ignition"
import type { FireFxLayer } from "@/map3d/FireFxLayer"

// ---------------------------------------------------------------------------
// Marqueur à compte à rebours (déplaçable, annulable)
// ---------------------------------------------------------------------------
const RING_R = 17
const RING_LEN = 2 * Math.PI * RING_R

export function IgnitionMarker({ pending, fx, onFire, onCancel, onMove }: {
  pending: PendingFire
  fx: FireFxLayer
  onFire: () => void
  onCancel: () => void
  onMove: (lat: number, lon: number) => void
}) {
  const [held, setHeld] = useState(false)
  const [remain, setRemain] = useState(IGNITION_DELAY_MS)
  const startRef = useRef(0)
  const onFireRef = useRef(onFire)
  useEffect(() => { onFireRef.current = onFire })

  // Balise 3D : points [lon, lat] (référence stable tant que le départ ne bouge pas)
  const points = useMemo<[number, number][]>(
    () => (pending.kind === "point" ? [[pending.lon, pending.lat]] : pending.points.map(([la, lo]) => [lo, la])),
    [pending],
  )

  // Compte à rebours : repart de 3 s à chaque dépôt, suspendu pendant le déplacement
  useEffect(() => {
    if (held) {
      fx.setIgnition({ points, progress: 0, held: true })
      return
    }
    startRef.current = performance.now()
    let raf = 0
    const tick = () => {
      const left = IGNITION_DELAY_MS - (performance.now() - startRef.current)
      fx.setIgnition({ points, progress: Math.min(1, 1 - left / IGNITION_DELAY_MS), held: false })
      if (left <= 0) {
        onFireRef.current()
        return
      }
      setRemain(left)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [held, points, fx])

  useEffect(() => () => fx.setIgnition(null), [fx])

  const [lat, lon] = anchorOf(pending)
  const progress = held ? 0 : 1 - remain / IGNITION_DELAY_MS
  const label = pending.kind === "line"
    ? `Ligne de feu · ${Math.round(lineLengthM(pending.points))} m`
    : `Départ ${pending.radius === 0 ? "petit" : pending.radius <= 75 ? "moyen" : "grand"}`

  return (
    <Marker
      latitude={lat}
      longitude={lon}
      anchor="top"
      offset={[0, 10]}
      draggable
      onDragStart={() => setHeld(true)}
      onDrag={(e) => onMove(e.lngLat.lat, e.lngLat.lng)}
      onDragEnd={(e) => { onMove(e.lngLat.lat, e.lngLat.lng); setHeld(false) }}
    >
      <div className="relative flex items-center gap-1.5 select-none cursor-grab active:cursor-grabbing"
        onClick={(e) => e.stopPropagation()}
        style={{ transform: "translateX(calc(50% - 22px))" }}>
        {/* repère vers le point d'allumage (au-dessus de la pastille) */}
        <span className="absolute left-[21px] -top-[10px] w-[2px] h-[10px] rounded-full" style={{ background: C.fire }} />
        <div className="relative w-11 h-11 flex items-center justify-center rounded-full"
          style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", boxShadow: `0 0 18px ${alpha(C.fire, 0.45)}` }}>
          <svg className="absolute inset-0" viewBox="0 0 44 44" aria-hidden>
            <circle cx="22" cy="22" r={RING_R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
            <circle cx="22" cy="22" r={RING_R} fill="none" stroke={C.fire} strokeWidth="3" strokeLinecap="round"
              strokeDasharray={RING_LEN} strokeDashoffset={RING_LEN * (1 - progress)} transform="rotate(-90 22 22)" />
          </svg>
          {held
            ? <Flame className="w-4 h-4" style={{ color: C.fire }} />
            : <span className="text-[15px] font-semibold tabular" style={{ color: C.text }}>{Math.ceil(remain / 1000)}</span>}
        </div>
        <div className="flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full"
          style={{ background: "rgba(0,0,0,0.72)", border: `1px solid ${alpha(C.fire, 0.35)}`, backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}>
          <span className="text-[10px] font-medium whitespace-nowrap" style={{ color: C.text }}>{held ? "Déplacement…" : label}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onCancel() }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Annuler le départ de feu"
            title="Annuler (Échap)"
            className="w-5 h-5 rounded-full flex items-center justify-center spring-hover"
            style={{ background: C.fill, color: C.text2 }}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    </Marker>
  )
}

// ---------------------------------------------------------------------------
// Menu contextuel (clic droit sur la carte)
// ---------------------------------------------------------------------------
const MENU_W = 236

function MenuItem({ icon: Icon, label, sub, danger, onClick }: {
  icon: typeof Flame; label: string; sub?: string; danger?: boolean; onClick: () => void
}) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] text-left menu-item">
      <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: alpha(danger ? C.red : C.fire, 0.16) }}>
        <Icon className="w-3.5 h-3.5" style={{ color: danger ? C.red : C.fire }} />
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] font-medium" style={{ color: C.text }}>{label}</span>
        {sub && <span className="block text-[10px]" style={{ color: C.text3 }}>{sub}</span>}
      </span>
    </button>
  )
}

export function MapContextMenu({ menu, onClose, onIgnite, sendCommand }: {
  menu: MapMenuState
  onClose: () => void
  onIgnite: (lat: number, lon: number) => void
  sendCommand: (type: string, payload?: Record<string, unknown>) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [h, setH] = useState(240)
  useEffect(() => { if (ref.current) setH(ref.current.offsetHeight) }, [menu])
  const left = Math.min(menu.x + 6, menu.w - MENU_W - 8)
  const top = Math.min(menu.y + 6, menu.h - h - 8)
  const run = (fn: () => void) => () => { fn(); onClose() }
  const { lat, lon } = menu

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute z-40 p-1.5 rounded-2xl"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        left: Math.max(8, left), top: Math.max(8, top), width: MENU_W,
        background: "rgba(14,14,14,0.86)", backdropFilter: "blur(24px) saturate(140%)", WebkitBackdropFilter: "blur(24px) saturate(140%)",
        border: `1px solid ${C.line}`, boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        animation: "tooltipIn 0.18s cubic-bezier(0.34,1.56,0.64,1) both",
      }}
    >
      <div className="px-2.5 pt-1 pb-1.5 text-[9px] uppercase font-semibold tabular" style={{ color: C.text4, letterSpacing: "0.09em" }}>
        {menu.onFire ? "Feu" : "Ici"} · {lat.toFixed(4)}, {lon.toFixed(4)}
      </div>
      {menu.onFire ? (
        <>
          <MenuItem icon={Droplets} label="Envoyer le Canadair ici" sub="Largage d'eau sur 150 m" onClick={run(() => sendCommand("water", { lat, lon, radius: 150 }))} />
          <MenuItem icon={Ban} danger label="Éteindre ce feu" sub="Fin de scénario : le foyer s'éteint" onClick={run(() => sendCommand("fire_out", { lat, lon }))} />
        </>
      ) : (
        <>
          <MenuItem icon={Flame} label="Allumer un feu ici" sub={`Départ ${FIRE_SIZE_LABEL[fireTool.size].toLowerCase()} · 3 s pour annuler`} onClick={run(() => onIgnite(lat, lon))} />
          <MenuItem icon={Droplets} label="Larguer de l'eau ici" sub="Canadair, 150 m" onClick={run(() => sendCommand("water", { lat, lon, radius: 150 }))} />
        </>
      )}
      <div className="mx-2 my-1.5 h-px" style={{ background: C.line }} />
      <div className="px-2.5 pb-1 text-[9px] uppercase font-semibold" style={{ color: C.text4, letterSpacing: "0.09em" }}>Ajouter un appareil</div>
      <div className="grid grid-cols-6 gap-1 px-1 pb-1">
        {(Object.keys(KIND_META) as DeviceKind[]).map((k) => {
          const m = KIND_META[k]
          return (
            <button key={k} title={`${m.label} · ${m.model}`} aria-label={`Ajouter : ${m.label}`}
              onClick={run(() => sendCommand("device_add", { kind: k, lat, lon }))}
              className="h-8 rounded-lg flex items-center justify-center menu-item">
              <m.Icon className="w-3.5 h-3.5" style={{ color: C.text2 }} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
