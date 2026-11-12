/**
 * Classification des fausses alertes.
 *
 * Retourne { kind: string | null, label: string } :
 *   null    = rien à signaler, continuer la détection
 *   "véhicule"           CO sans fumée, près d'une route
 *   "brouillard"         fumée + hum > 85 %, sans CO
 *   "soleil"             temp sans fumée ni CO, de jour, capteur isolé
 *   "brûlage_autorisé"   source dans une zone de brûlage déclarée
 *   "barbecue_probable"  foyer estimé à < 200 m d'un village, intensité faible
 */

/** Heure du jour (UTC) considérée comme "de jour". */
const DAY_HOURS = { start: 7, end: 19 }

function isDay() {
  const h = new Date().getUTCHours()
  return h >= DAY_HOURS.start && h < DAY_HOURS.end
}

/**
 * Classe une alerte comme fausse si les conditions sont réunies.
 *
 * @param {object} ind       – indicateurs computeIndicators()
 * @param {object} readings  – mesures brutes
 * @param {object} context   – { nearRoad, burnZones:[polygon], villages, estimatedPos, isolated }
 * @returns {{ kind: string|null, label: string }}
 */
export function classifyFalseAlert(ind, readings, context = {}) {
  const r = readings || {}
  const hum = r.hum ?? 50

  // 1. CO sans fumée, près d'une route → véhicule
  if (ind.co && !ind.smoke && context.nearRoad) {
    return { kind: "véhicule", label: "CO véhicule détecté (route proche, sans fumée)" }
  }

  // 2. Fumée + humidité > 85 % et sans CO → brouillard (MQ-2 trompé)
  if (ind.smoke && hum > 85 && !ind.co && !ind.flame) {
    return { kind: "brouillard", label: "Fausse fumée – humidité > 85 % (brouillard/condensation)" }
  }

  // 3. Température sans fumée ni CO, de jour, capteur isolé → chaleur solaire
  if (ind.tempRise && !ind.smoke && !ind.co && !ind.flame && isDay() && context.isolated) {
    return { kind: "soleil", label: "Hausse de température sans fumée (capteur chauffé au soleil)" }
  }

  // 4. Source dans une zone de brûlage déclarée
  if (context.burnZones?.length && context.estimatedPos) {
    for (const zone of context.burnZones) {
      if (pointInPolygon(context.estimatedPos, zone)) {
        return { kind: "brûlage_autorisé", label: "Source dans zone de brûlage agricole déclarée" }
      }
    }
  }

  // 5. Foyer estimé à < 200 m d'un village, intensité faible → barbecue
  if (context.villages?.length && context.estimatedPos && context.confidence < 40) {
    for (const village of context.villages) {
      const d = distM(context.estimatedPos.lat, context.estimatedPos.lon, village.lat, village.lon)
      if (d < 200) {
        return {
          kind: "barbecue_probable",
          label: `Foyer à ${Math.round(d)} m de ${village.name} – barbecue probable (à vérifier)`,
        }
      }
    }
  }

  return { kind: null, label: "" }
}

// ---------------------------------------------------------------------------
// Utilitaires géo
// ---------------------------------------------------------------------------
function distM(lat1, lon1, lat2, lon2) {
  const dlat = (lat2 - lat1) * 111_320
  const dlon = (lon2 - lon1) * 111_320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180))
  return Math.hypot(dlat, dlon)
}

function pointInPolygon(pt, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    const intersect =
      yi > pt.lon !== yj > pt.lon &&
      pt.lat < ((xj - xi) * (pt.lon - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}
