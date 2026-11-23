/**
 * Caméra thermique pilotée (§6.7) : en pré-alerte, la caméra la plus proche du foyer
 * estimé, avec ligne de vue, est orientée vers la zone ; sa mesure renforce ou infirme
 * l'alerte. Module pur : la ligne de vue est une fonction fournie par l'appelant.
 */
import { bearing, distance } from "../geo.js"

export const CAMERA = {
  rangeM: 800,        // portée du MLX90640 sur un feu de végétation
  maxTaskM: 1500,     // au-delà, aucune caméra n'est assignée
  alignDeg: 8,        // la caméra vise la zone quand son azimut est à ± 8° du relèvement
  infirmFactor: 0.6,  // « rien de chaud dans le cône » : le score est réduit de 40 %
}

const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180)

/** Appareil caméra thermique (mesures tmax / azimut). */
export const isCamera = (n) => n?.kind === "thermal" || Number.isFinite(n?.readings?.tmax)

/**
 * Choisit la caméra à orienter vers `target`.
 * Préférence : ligne de vue et à portée, puis la plus proche ; jamais au-delà de maxTaskM.
 * @param {object[]} cameras  nœuds caméra en ligne et sains [{id, lat, lon, readings}]
 * @param {{lat, lon}} target
 * @param {(cam, target) => boolean} [los]  ligne de vue (relief) ; absente = visible
 * @returns {{id, bearing, distance, los, inRange}|null}
 */
export function chooseCamera(cameras, target, los = () => true) {
  let best = null
  for (const cam of cameras) {
    const d = distance(cam, target)
    if (d > CAMERA.maxTaskM) continue
    const visible = d < 60 || los(cam, target)
    const inRange = d <= CAMERA.rangeM
    const rank = (visible ? 0 : 2) + (inRange ? 0 : 1)
    if (!best || rank < best.rank || (rank === best.rank && d < best.distance)) {
      best = { id: cam.id, bearing: Math.round(bearing(cam, target)), distance: Math.round(d), los: visible, inRange, rank }
    }
  }
  if (!best) return null
  const { rank: _rank, ...out } = best
  return out
}

/**
 * Verdict de la caméra assignée, d'après sa dernière mesure (l'azimut mesuré est celui
 * de la prise de vue) :
 *   "orientation"  pas encore alignée sur la zone
 *   "hors_portée"  zone au-delà de la portée ou masquée par le relief
 *   "confirme"     point chaud dans le cône (relèvement mesuré)
 *   "infirme"      la caméra vise la zone et ne voit rien de chaud
 */
export function cameraVerdict(cam, target, { tmaxHot = 60, los = true } = {}) {
  const r = cam.readings || {}
  const b = bearing(cam, target)
  const d = distance(cam, target)
  const az = Number.isFinite(r.azimuth) ? r.azimuth : null
  const base = { id: cam.id, bearing: Math.round(b), distance: Math.round(d), azimuth: az, tmax: r.tmax, hotBearing: r.hot_bearing }
  if (az === null || angleDiff(az, b) > CAMERA.alignDeg) return { ...base, state: "orientation" }
  // Un point chaud dans le cône confirme, même si le foyer estimé (barycentre des
  // capteurs, décalé sous le vent) semble hors de portée : le cône fait 110°
  if ((r.tmax ?? 0) > tmaxHot) return { ...base, state: "confirme" }
  if (d > CAMERA.rangeM || !los) return { ...base, state: "hors_portée" }
  return { ...base, state: "infirme" }
}

/**
 * Affinage du foyer par le relèvement d'une caméra qui voit un point chaud : le point
 * du rayon le plus proche de l'estimation, moyenné avec elle ; l'incertitude diminue.
 */
export function refineWithBearing(pos, cam) {
  const hb = cam.readings?.hot_bearing
  if (!pos || !Number.isFinite(hb)) return pos
  const d = Math.min(CAMERA.rangeM, Math.max(50, distance(cam, pos)))
  const rad = (hb * Math.PI) / 180
  const k = Math.cos((cam.lat * Math.PI) / 180)
  const onRay = {
    lat: cam.lat + (d * Math.cos(rad)) / 111_320,
    lon: cam.lon + (d * Math.sin(rad)) / (111_320 * k),
  }
  return {
    lat: (pos.lat + onRay.lat) / 2,
    lon: (pos.lon + onRay.lon) / 2,
    uncertainty_m: Math.max(60, Math.round((pos.uncertainty_m ?? 300) * 0.6)),
    refinedBy: cam.id,
  }
}
