/**
 * Fausses alertes (§6.5) : un test par cause au niveau du pipeline complet (evaluate),
 * et les contre-exemples qui garantissent qu'un vrai feu n'est jamais écarté.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { evaluate, resetState } from "../detection/index.js"
import { classifyCluster, isDayNow } from "../detection/classifier.js"
import { offset } from "../geo.js"

const NOW = 1_800_000_000_000
const C = { lat: 35.135, lon: -5.215 }
const at = (north, east) => offset(C, north, east)

const ROAD = { name: "Piste", points: [[at(-60, -800).lat, at(-60, -800).lon], [at(-60, 800).lat, at(-60, 800).lon]] }
const VILLAGE = { name: "Hameau forestier", ...at(150, 120) }
const ZONE = {
  name: "Parcelle agricole",
  polygon: [[at(-100, -100).lat, at(-100, -100).lon], [at(100, -100).lat, at(100, -100).lon],
            [at(100, 100).lat, at(100, 100).lon], [at(-100, 100).lat, at(-100, 100).lon]],
}
const GIS = { roads: [ROAD], villages: [VILLAGE], isDay: true }

const calm = { temp: 30, hum: 30, smoke: 25, co: 2, flame: false, wind_speed: 6, wind_dir: 100, bat: 90 }
function node(id, pos, readings = {}, ts = NOW - 2000) {
  return { id, lat: pos.lat, lon: pos.lon, ts, period: 10, readings: { ...calm, ...readings } }
}

beforeEach(() => resetState())

describe("Fausses alertes évitées (pipeline complet)", () => {
  it("véhicule : CO sans fumée au bord de la piste → aucune alerte", () => {
    const r = evaluate([node("N02", at(0, 0), { co: 85 }), node("N06", at(900, 0))], NOW, GIS)
    expect(r.falseAlert?.kind).toBe("véhicule")
    expect(r.falseAlert.nodes).toEqual(["N02"])
    expect(r.level).not.toMatch(/suspicion|pré-alerte|feu_confirmé/)
    expect(r.confirmed).toBe(false)
  })

  it("brouillard : fumée seule par humidité > 85 %, sans CO → aucune alerte", () => {
    const fog = { hum: 93, smoke: 380, temp: 18 }
    const r = evaluate([node("N01", at(0, 0), fog), node("N02", at(0, 700), fog), node("N06", at(900, 0))], NOW, GIS)
    expect(r.falseAlert?.kind).toBe("brouillard")
    expect(r.suspects).toEqual([])
    expect(r.confirmed).toBe(false)
  })

  it("brouillard : un peu de bruit sur le CO ne change rien", () => {
    const r = evaluate([node("N01", at(-900, -900), { hum: 92, smoke: 380, co: 4.2 })], NOW, GIS)
    expect(r.falseAlert?.kind).toBe("brouillard")
    expect(r.confirmed).toBe(false)
  })

  it("brûlage déclaré : foyer estimé dans la zone → aucune alerte", () => {
    const r = evaluate([node("N10", at(20, 10), { smoke: 1800, co: 290, temp: 38 })], NOW, { ...GIS, burnZones: [ZONE] })
    expect(r.falseAlert?.kind).toBe("brûlage_autorisé")
    expect(r.falseAlert.label).toContain("Parcelle agricole")
    expect(r.confirmed).toBe(false)
  })

  it("soleil : un capteur isolé qui chauffe vite, sans fumée ni CO, de jour → aucune alerte", () => {
    const pos = at(900, 900)
    evaluate([node("N07", pos, { temp: 31 }, NOW - 62_000), node("N08", at(0, 0), {}, NOW - 62_000)], NOW - 61_000, GIS)
    evaluate([node("N07", pos, { temp: 31.5 }, NOW - 31_000), node("N08", at(0, 0), {}, NOW - 31_000)], NOW - 30_000, GIS)
    const r = evaluate([node("N07", pos, { temp: 49, hum: 12 }, NOW - 1000), node("N08", at(0, 0), {}, NOW - 1000)], NOW, GIS)
    expect(r.falseAlert?.kind).toBe("soleil")
    expect(r.confirmed).toBe(false)
  })

  it("barbecue : petite source près du hameau, sans flamme → à vérifier, aucune alerte", () => {
    const r = evaluate([node("N01", at(0, 0), { smoke: 520, co: 80 })], NOW, GIS)
    expect(r.falseAlert?.kind).toBe("barbecue_probable")
    expect(r.falseAlert.reason).toMatch(/à vérifier/)
    expect(r.confirmed).toBe(false)
  })
})

describe("Robustesse", () => {
  it("variation régionale : toute la zone se réchauffe d'un coup (changement de météo) → pas de suspect", () => {
    const ids = ["A", "B", "C", "D", "E"]
    const pos = ids.map((_, i) => at(i * 600 - 1200, (i % 2) * 700))
    evaluate(ids.map((id, i) => node(id, pos[i], { temp: 24, hum: 45 }, NOW - 31_000)), NOW - 30_000, GIS)
    const r = evaluate(ids.map((id, i) => node(id, pos[i], { temp: 36, hum: 18 }, NOW - 1000)), NOW, GIS)
    expect(r.suspects).toEqual([])
    expect(r.level).not.toMatch(/suspicion|pré-alerte|feu_confirmé/)
  })

  it("brûlage : capteur à 550 m, zone déclarée au vent (cohérence du vent) → aucune alerte", () => {
    // vent du 100° : la fumée part vers l'ouest-nord-ouest ; capteur à 550 m sous le vent
    const far = offset(C, 550 * Math.cos((280 * Math.PI) / 180), 550 * Math.sin((280 * Math.PI) / 180))
    const r = evaluate([node("N11", far, { smoke: 320, co: 38, wind_speed: 7, wind_dir: 100 })], NOW, { ...GIS, burnZones: [ZONE] })
    expect(r.falseAlert?.kind).toBe("brûlage_autorisé")
    expect(r.falseAlert.reason).toMatch(/au vent/)
  })
})

describe("Un vrai feu n'est jamais écarté", () => {
  it("fumée par temps humide avec le CO d'une combustion → pas « brouillard »", () => {
    const r = evaluate([node("N01", at(-1200, 900), { hum: 90, smoke: 700, co: 95 }), node("N02", at(-900, 1200), { hum: 91, smoke: 500, co: 70 })], NOW, GIS)
    expect(r.falseAlerts.map((f) => f.kind)).not.toContain("brouillard")
    expect(r.level).toMatch(/suspicion|pré-alerte|feu_confirmé/)
  })

  it("feu au bord de la route (fumée + CO) → confirmé", () => {
    const fire = { smoke: 900, co: 60, temp: 60, hum: 14, flame: true }
    const r = evaluate([node("N02", at(0, 0), fire), node("N03", at(0, 400), { smoke: 600, co: 40 })], NOW, GIS)
    expect(r.falseAlert).toBeNull()
    expect(r.confirmed).toBe(true)
  })

  it("brûlage qui s'échappe : capteurs touchés hors de la zone → confirmé", () => {
    const smoky = { smoke: 900, co: 60, temp: 45, hum: 15 }
    const nodes = [
      node("N10", at(20, 10), { ...smoky, flame: true }),
      node("N11", at(300, -500), smoky),
      node("N12", at(-200, -900), smoky),
      node("N13", at(1500, -1400), smoky),
    ]
    const r = evaluate(nodes, NOW, { ...GIS, burnZones: [ZONE] })
    expect(r.falseAlerts.map((f) => f.kind)).not.toContain("brûlage_autorisé")
    expect(r.confirmed).toBe(true)
  })

  it("brouillard + vrai feu avec CO → le feu est confirmé, le brouillard signalé à part", () => {
    const r = evaluate([
      node("FOG", at(0, -1500), { hum: 95, smoke: 400 }),
      node("FEU1", at(0, 1500), { smoke: 900, co: 60, temp: 62, hum: 15, flame: true }),
      node("FEU2", at(200, 1300), { smoke: 700, co: 45, hum: 18 }),
    ], NOW, GIS)
    expect(r.confirmed).toBe(true)
    expect(r.suspects).not.toContain("FOG")
    expect(r.falseAlerts.map((f) => f.kind)).toContain("brouillard")
  })

  it("barbecue avec une flamme → pas écarté", () => {
    const r = evaluate([node("N01", at(0, 0), { smoke: 520, co: 80, flame: true })], NOW, GIS)
    expect(r.falseAlerts.map((f) => f.kind)).not.toContain("barbecue_probable")
    expect(r.level).toMatch(/suspicion|pré-alerte|feu_confirmé/)
  })
})

describe("classifyCluster", () => {
  const ind = (o) => ({ flame: false, hotspot: false, smoke: false, co: false, tempRise: false, humDrop: false, ...o })
  const one = (pos, indicators, readings = {}) => [{ id: "X", lat: pos.lat, lon: pos.lon, indicators: ind(indicators), readings: { ...calm, ...readings } }]

  it("soleil seulement de jour", () => {
    const c = one(at(900, 900), { tempRise: true }, { temp: 49 })
    expect(classifyCluster(c, { isDay: true })?.kind).toBe("soleil")
    expect(classifyCluster(c, { isDay: false })).toBeNull()
  })

  it("CO loin de toute route → pas « véhicule »", () => {
    expect(classifyCluster(one(at(900, 900), { co: true }, { co: 80 }), GIS)).toBeNull()
  })

  it("jour au Maroc (UTC+1) : 12 h oui, 2 h non", () => {
    expect(isDayNow(Date.UTC(2026, 6, 1, 11))).toBe(true)
    expect(isDayNow(Date.UTC(2026, 6, 1, 1))).toBe(false)
  })
})
