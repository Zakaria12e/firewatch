/**
 * Caméra thermique pilotée (P0.4) : choix de la caméra, verdict, affinage du foyer
 * par relèvement, effet sur le score, ordre d'orientation dans le downlink.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { decode } from "cbor-x"
import { chooseCamera, cameraVerdict, refineWithBearing, CAMERA } from "../detection/camera.js"
import { evaluate, resetState } from "../detection/index.js"
import { localizeFire } from "../detection/localize.js"
import { encodeDownlink } from "../lora/downlink.js"
import { offset, bearing, distance } from "../geo.js"

const NOW = 1_800_000_000_000
const C = { lat: 35.135, lon: -5.215 }
const at = (n, e) => offset(C, n, e)
const cam = (id, pos, readings = {}) => ({
  id, kind: "thermal", lat: pos.lat, lon: pos.lon, ts: NOW - 1000, period: 2,
  readings: { tmax: 38, hot_bearing: 0, hot_px: 0, azimuth: 0, bat: 90, ...readings },
})
const node = (id, pos, readings = {}) => ({
  id, lat: pos.lat, lon: pos.lon, ts: NOW - 1000, period: 2,
  readings: { temp: 30, hum: 30, smoke: 25, co: 2, flame: false, wind_speed: 6, wind_dir: 100, bat: 90, ...readings },
})

beforeEach(() => resetState())

describe("chooseCamera", () => {
  const target = at(0, 0)
  it("préfère une caméra à portée avec ligne de vue, même plus loin", () => {
    const near = cam("C1", at(0, 300))
    const far = cam("C2", at(0, -600))
    const los = (c) => c.id !== "C1"   // C1 masquée par une crête
    const pick = chooseCamera([near, far], target, los)
    expect(pick.id).toBe("C2")
    expect(pick.los).toBe(true)
    expect(pick.bearing).toBeCloseTo(90, 0)   // C2 à l'ouest : elle regarde vers l'est
  })

  it("aucune caméra au-delà de 1,5 km", () => {
    expect(chooseCamera([cam("C1", at(0, 2000))], target)).toBeNull()
  })
})

describe("cameraVerdict", () => {
  const target = at(0, 500)   // à l'est de la caméra
  it("orientation tant que l'azimut n'est pas aligné", () => {
    expect(cameraVerdict(cam("C1", at(0, 0), { azimuth: 10 }), target).state).toBe("orientation")
  })
  it("confirme : alignée et point chaud", () => {
    const v = cameraVerdict(cam("C1", at(0, 0), { azimuth: 90, tmax: 212, hot_bearing: 92 }), target)
    expect(v.state).toBe("confirme")
  })
  it("infirme : alignée, à portée, rien de chaud", () => {
    expect(cameraVerdict(cam("C1", at(0, 0), { azimuth: 89, tmax: 39 }), target).state).toBe("infirme")
  })
  it("hors portée : la caméra ne peut ni confirmer ni infirmer", () => {
    expect(cameraVerdict(cam("C1", at(0, 0), { azimuth: 90 }), at(0, CAMERA.rangeM + 200)).state).toBe("hors_portée")
  })
})

describe("Localisation", () => {
  it("la position d'une caméra n'entre pas dans le barycentre ; son relèvement affine le foyer", () => {
    const fire = at(0, 0)
    const camera = cam("C1", at(0, -600), { azimuth: 90, tmax: 250, hot_bearing: Math.round(bearing(at(0, -600), fire)) })
    camera.indicators = { hotspot: true }
    const smokers = [
      { ...node("N1", at(250, -300), { smoke: 900 }), indicators: { smoke: true } },
      { ...node("N2", at(-250, -350), { smoke: 700 }), indicators: { smoke: true } },
    ]
    const without = localizeFire(smokers, smokers, { speed: 6, from: 90 })
    const withCam = localizeFire([...smokers, camera], smokers, { speed: 6, from: 90 })
    expect(withCam.refinedBy).toBe("C1")
    expect(distance(withCam, fire)).toBeLessThan(distance(without, fire))
    expect(withCam.uncertainty_m).toBeLessThan(without.uncertainty_m)
  })

  it("refineWithBearing sans relèvement ne change rien", () => {
    const p = { lat: 35.13, lon: -5.21, uncertainty_m: 300 }
    expect(refineWithBearing(p, { lat: 35.1, lon: -5.2, readings: {} })).toBe(p)
  })
})

describe("Effet sur l'alerte (pipeline complet)", () => {
  // Fumée seule sur trois capteurs : pré-alerte sans caméra
  const smoke = () => [
    node("N1", at(0, 0), { smoke: 650, co: 40 }),
    node("N2", at(300, 200), { smoke: 520, co: 32 }),
    node("N3", at(-250, 150), { smoke: 480, co: 30 }),
  ]

  it("infirme : la caméra vise la zone et ne voit rien → score réduit, plus de confirmation par le score", () => {
    const ref = evaluate(smoke(), NOW, {})
    resetState()
    const camera = cam("C1", at(0, -500), { azimuth: 90, tmax: 37 })
    const target = { lat: ref.position.lat, lon: ref.position.lon }
    const aimed = { ...camera, readings: { ...camera.readings, azimuth: Math.round(bearing(camera, target)) } }
    const r = evaluate([...smoke(), aimed], NOW, { cameraTask: { camId: "C1", target } })
    expect(r.camera.state).toBe("infirme")
    expect(r.score).toBe(Math.round(ref.score * CAMERA.infirmFactor))
    expect(r.score).toBeLessThan(ref.score)
  })

  it("confirme : point chaud vu par la caméra + fumée → feu confirmé", () => {
    const target = at(0, 0)
    const camera = cam("C1", at(0, -500), { azimuth: 90, tmax: 230, hot_bearing: 90 })
    const r = evaluate([...smoke(), camera], NOW, { cameraTask: { camId: "C1", target } })
    expect(r.camera.state).toBe("confirme")
    expect(r.confirmed).toBe(true)
  })

  it("flamme + fumée : confirmé même si la caméra ne voit rien (caméra masquée)", () => {
    const nodes = [node("N1", at(0, 0), { smoke: 900, co: 60, flame: true, temp: 60 }), node("N2", at(200, 200), { smoke: 600, co: 40 })]
    const ref = evaluate(nodes, NOW, {})
    resetState()
    const camera = cam("C1", at(0, -500), { tmax: 36 })
    camera.readings.azimuth = Math.round(bearing(camera, ref.position))
    const r = evaluate([...nodes, camera], NOW, { cameraTask: { camId: "C1", target: { lat: ref.position.lat, lon: ref.position.lon } } })
    expect(r.camera.state).toBe("infirme")
    expect(r.confirmed).toBe(true)
  })
})

describe("Downlink", () => {
  it("azimut de la caméra en clé 3, entier 0-359", () => {
    expect(decode(encodeDownlink({ period: 2, siren: false, azimuth: 452.4 }))).toEqual({ 1: 2, 2: 0, 3: 92 })
    expect(decode(encodeDownlink({ period: 10 }))).toEqual({ 1: 10, 2: 0 })
  })
})
