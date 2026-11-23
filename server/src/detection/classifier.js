/**
 * Classification des fausses alertes (§6.5). Module pur.
 *
 * Un groupe de capteurs suspects (un foyer potentiel) est jugé en entier, à chaque
 * évaluation : rien n'est mémorisé. Dès qu'un groupe ne colle plus à une cause
 * bénigne (flamme qui apparaît, fumée hors de la zone déclarée, trop de capteurs…),
 * il repasse dans la détection normale.
 *
 * Causes (kind) :
 *   "brûlage_autorisé"   foyer estimé dans (ou au bord d') une zone de brûlage déclarée
 *   "véhicule"           CO sans fumée, capteurs au bord d'une route
 *   "brouillard"         fumée seule, humidité > 85 %, sans CO (MQ-2 trompé)
 *   "soleil"             montée de température sans fumée ni CO, capteur isolé, de jour
 *   "barbecue_probable"  petite source près d'un village, sans flamme (à vérifier)
 */
import { distance, distanceToPolyline, distanceToPolygon, bearing } from "../geo.js"

export const FALSE_ALERT_LABEL = {
  "brûlage_autorisé": "brûlage autorisé",
  "véhicule": "véhicule sur la route",
  "brouillard": "brouillard",
  "soleil": "capteur chauffé au soleil",
  "barbecue_probable": "barbecue probable",
}

/** Seuils des règles (m, %, ppm). */
export const RULES = {
  burnZoneToleranceM: 250,   // le foyer estimé est un barycentre de capteurs, pas la source
  burnEscapeM: 1200,         // un suspect plus loin de la zone : le feu s'est échappé
  burnMaxSensors: 3,
  roadM: 300,
  fogHum: 85,
  fogCoPerSmoke: 0.05,        // combustion : ~0,16 ppm de CO par ppm de fumée ; brouillard : ~0
  villageM: 350,
  barbecueMaxSensors: 2,
  barbecueMaxSmoke: 1200,
  upwindDeg: 40,             // la source doit être au vent du capteur, à ± 40° du vent mesuré
  upwindMaxM: 1500,
  upwindMinWind: 1.5,        // m/s : sous ce vent, la direction n'est pas fiable
  nearSourceM: 650,          // capteur assez proche pour sentir la diffusion, même au vent
}

/**
 * La source candidate est-elle au vent de chacun des capteurs qui sentent la fumée ?
 * (cohérence avec le vent, §6.6 : la fumée part sous le vent de la source)
 */
function upwindOfAll(nodes, target, wind) {
  if (!wind || wind.speed < RULES.upwindMinWind || !nodes.length) return false
  return nodes.every((n) => {
    const d = distance(n, target)
    if (d > RULES.upwindMaxM) return false
    if (d <= RULES.nearSourceM) return true   // diffusion autour de la source
    const off = Math.abs(((bearing(n, target) - wind.from + 540) % 360) - 180)
    return off <= RULES.upwindDeg
  })
}

const centroid = (poly) => ({
  lat: poly.reduce((s, p) => s + p[0], 0) / poly.length,
  lon: poly.reduce((s, p) => s + p[1], 0) / poly.length,
})

/** Jour local (Maroc, UTC+1) : 7 h – 19 h. Remplaçable par context.isDay (tests). */
export function isDayNow(now = Date.now()) {
  const h = (new Date(now).getUTCHours() + 1) % 24
  return h >= 7 && h < 19
}

const any = (nodes, key) => nodes.some((n) => n.indicators?.[key])

/**
 * Fumée de brouillard : MQ-2 à humidité > 85 %, sans flamme ni chaleur, et sans le CO
 * qu'une vraie combustion produit avec cette fumée (le z-score du CO peut bouger sur
 * du bruit : on compare le CO à la fumée, pas seulement l'indicateur).
 */
export function isFogSmoke(n) {
  const i = n.indicators || {}
  const r = n.readings || {}
  if (!i.smoke || i.flame || i.hotspot || i.tempRise) return false
  if ((r.hum ?? 0) <= RULES.fogHum) return false
  const coExcess = Math.max(0, (r.co ?? 0) - 2)
  const smokeExcess = Math.max(0, (r.smoke ?? 0) - 25)
  return coExcess <= 1.5 + RULES.fogCoPerSmoke * smokeExcess
}

/**
 * @param {object[]} cluster  suspects d'un même foyer : [{id, lat, lon, readings, indicators}]
 * @param {object}   ctx      { estimatedPos, burnZones:[{name?, polygon}|polygon], roads:[{points}],
 *                              villages:[{name, lat, lon}], isDay }
 * @returns {{kind, label, reason, nodes}|null}
 */
export function classifyCluster(cluster, ctx = {}) {
  if (!cluster?.length) return null
  const nodes = cluster.map((n) => n.id)
  const flame = any(cluster, "flame")
  const hot = any(cluster, "hotspot")
  const smoke = any(cluster, "smoke")
  const co = any(cluster, "co")
  const pos = ctx.estimatedPos

  // 1. Brûlage déclaré : foyer estimé dans la zone, ou zone au vent de chaque capteur
  //    qui sent la fumée ; le groupe doit rester local (sinon le feu s'est échappé)
  const smokers = cluster.filter((n) => n.indicators?.smoke || n.indicators?.co)
  if ((pos || smokers.length) && ctx.burnZones?.length) {
    for (const z of ctx.burnZones) {
      const poly = Array.isArray(z) ? z : z.polygon
      if (!Array.isArray(poly) || poly.length < 3) continue
      const d = pos ? distanceToPolygon(pos, poly) : Infinity
      const contained = cluster.length <= RULES.burnMaxSensors &&
        cluster.every((n) => distanceToPolygon(n, poly) <= RULES.burnEscapeM)
      if (!contained) continue
      const name = Array.isArray(z) ? "zone déclarée" : z.name ?? "zone déclarée"
      if (d <= RULES.burnZoneToleranceM) {
        return {
          kind: "brûlage_autorisé",
          label: `Brûlage dans « ${name} »`,
          reason: d === 0 ? "foyer estimé dans la zone de brûlage déclarée" : `foyer estimé à ${Math.round(d)} m de la zone de brûlage déclarée`,
          nodes,
        }
      }
      if (smokers.length && upwindOfAll(smokers, centroid(poly), ctx.wind)) {
        return {
          kind: "brûlage_autorisé",
          label: `Brûlage dans « ${name} »`,
          reason: `zone déclarée au vent de ${smokers.map((n) => n.id).join(", ")} (vent du ${Math.round(ctx.wind.from)}°)`,
          nodes,
        }
      }
    }
  }

  // 2. Véhicule : CO sans fumée ni chaleur, capteurs au bord d'une route
  if (co && !smoke && !flame && !hot && ctx.roads?.length) {
    const coNodes = cluster.filter((n) => n.indicators?.co)
    const near = coNodes.every((n) => ctx.roads.some((r) => distanceToPolyline(n, r.points) <= RULES.roadM))
    if (near) {
      const d = Math.min(...coNodes.map((n) => Math.min(...ctx.roads.map((r) => distanceToPolyline(n, r.points)))))
      return {
        kind: "véhicule",
        label: "CO sans fumée au bord de la piste",
        reason: `CO sur ${coNodes.map((n) => n.id).join(", ")} à ${Math.round(d)} m de la route, aucune fumée`,
        nodes,
      }
    }
  }

  // 3. Brouillard : fumée seule par humidité > 85 %, sans le CO d'une combustion
  if (smoke && !flame && !hot && !any(cluster, "tempRise")) {
    const smokers = cluster.filter((n) => n.indicators?.smoke)
    const others = cluster.filter((n) => !n.indicators?.smoke)
    if (smokers.every(isFogSmoke) && !others.some((n) => n.indicators?.co)) {
      const hum = Math.round(Math.min(...smokers.map((n) => n.readings.hum)))
      return {
        kind: "brouillard",
        label: "Fausse fumée par brouillard",
        reason: `MQ-2 à ≥ ${hum} % d'humidité, sans CO ni hausse de température`,
        nodes,
      }
    }
  }

  // 4. Soleil : un capteur isolé qui chauffe, sans fumée ni CO, de jour
  const day = ctx.isDay ?? isDayNow()
  if (cluster.length === 1 && any(cluster, "tempRise") && !smoke && !co && !flame && !hot && day) {
    return {
      kind: "soleil",
      label: "Capteur chauffé au soleil",
      reason: `${nodes[0]} seul en hausse de température, sans fumée ni CO, de jour`,
      nodes,
    }
  }

  // 5. Barbecue : petite fumée près d'un village (ou village au vent des capteurs), sans
  //    flamme, peu de capteurs (à vérifier sur place)
  if (smoke && pos && ctx.villages?.length && !flame && cluster.length <= RULES.barbecueMaxSensors) {
    const maxSmoke = Math.max(0, ...cluster.map((n) => n.readings?.smoke ?? 0))
    const smokeNodes = cluster.filter((n) => n.indicators?.smoke)
    for (const v of ctx.villages) {
      const d = distance(pos, v)
      const near = d <= RULES.villageM || (d <= RULES.upwindMaxM / 2 && upwindOfAll(smokeNodes, v, ctx.wind))
      if (near && maxSmoke < RULES.barbecueMaxSmoke) {
        return {
          kind: "barbecue_probable",
          label: `Barbecue probable à ${v.name}`,
          reason: `foyer estimé à ${Math.round(d)} m de ${v.name}, faible intensité (${Math.round(maxSmoke)} ppm), sans flamme : à vérifier`,
          nodes,
        }
      }
    }
  }

  return null
}

/**
 * Version « un seul capteur » (compatibilité) : indicateurs + mesures d'un nœud.
 * context = { nearRoad, burnZones, estimatedPos, villages, isolated, isDay, confidence }
 */
export function classifyFalseAlert(ind, readings, context = {}) {
  const node = { id: "?", lat: context.estimatedPos?.lat ?? 0, lon: context.estimatedPos?.lon ?? 0, indicators: ind, readings }
  const roads = context.nearRoad ? [{ points: [[node.lat, node.lon], [node.lat, node.lon + 1e-6]] }] : []
  const res = classifyCluster([node], { ...context, roads, isDay: context.isDay ?? true })
  return res ? { kind: res.kind, label: res.label } : { kind: null, label: "" }
}
