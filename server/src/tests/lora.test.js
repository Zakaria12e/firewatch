/**
 * Tests Vitest de la couche LoRaWAN : trame, inscription, mesures compactes,
 * reconstruction SenML, duty cycle et rejet des trames mal formées.
 *
 * Les vecteurs « Python » ont été produits par simulator/engine/lorawan.py : ils
 * garantissent que l'encodeur du simulateur et le décodeur du serveur s'accordent.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { encode, decode } from "cbor-x"
import { SCHEMA, maxPayload } from "../lora/schema.js"
import { parsePhy, buildPhy } from "../lora/frame.js"
import { airtimeMs, minIntervalS } from "../lora/airtime.js"
import {
  decodeInscription, decodeMeasures, buildSenml, labelSenml, senmlSizes,
  encodeInscription, encodeMeasures,
} from "../lora/codec.js"
import { createNetworkServer } from "../lora/network.js"
import { encodeDownlink } from "../lora/downlink.js"

const hex = (h) => new Uint8Array(Buffer.from(h, "hex"))

// Vecteurs produits par le simulateur Python
const PY = {
  devAddr: 0x27dd4f11,
  inscription: "40114fdd27800000018701634e3031011a00359ca83a0007f53d8c0102030405060708090a0b0c8c02030404050106070608090a00000000",
  mesures: "40114fdd27800100028c18fd1820181b150101185e182e1879185400185700000000",
  camInscription: "4042dc052780000001870163433031061a00359aa83a0007ef3f850d0e0f100c85020701070a00000000",
  camMesures: "4042dc0527800500028519084c184218251844184000000000",
}

const env = (phy, extra = {}) => ({ gw: "G01", rssi: -97.5, snr: 6.2, sf: 9, freq: 868.1, phy, ...extra })

// Valeurs extrêmes : les plus coûteuses à encoder en CBOR
const WORST = {
  temp: -40, hum: 100, smoke: 20000, co: 2500, ir: 1, flame: true, on: true,
  wind_speed: 60, wind_dir: 359, gust: 80, fmc: 35, rain: 120, bat: 100,
  tmax: 300, hot_bearing: 359, hot_px: 768, azimuth: 359,
}

describe("Trame LoRaWAN", () => {
  it("découpe la trame Python : DevAddr, FCnt, FPort, charge utile, MIC", () => {
    const f = parsePhy(hex(PY.mesures))
    expect(f.devAddr).toBe(PY.devAddr)
    expect(f.fcnt).toBe(1)
    expect(f.fport).toBe(SCHEMA.fport.mesures)
    expect(f.confirmed).toBe(false)
    expect(f.headerBytes).toBe(9)
    expect(f.length - f.payload.length).toBe(SCHEMA.overheadBytes)
  })

  it("buildPhy et parsePhy sont réciproques", () => {
    const payload = encode([1, 2, 3])
    const f = parsePhy(buildPhy({ devAddr: 0x26001234, fcnt: 65535, fport: 2, payload, confirmed: true }))
    expect(f.devAddr).toBe(0x26001234)
    expect(f.fcnt).toBe(65535)
    expect(f.confirmed).toBe(true)
    expect(Buffer.from(f.payload).equals(Buffer.from(payload))).toBe(true)
  })

  it("rejette une trame trop courte ou descendante", () => {
    expect(() => parsePhy(new Uint8Array(8))).toThrow(/trop courte/)
    const down = hex(PY.mesures)
    down[0] = 0x60   // Unconfirmed Data Down
    expect(() => parsePhy(down)).toThrow(/non montant/)
  })
})

describe("Inscription (FPort 1)", () => {
  it("décode l'inscription Python : type, position, canaux et unités", () => {
    const reg = decodeInscription(decode(parsePhy(hex(PY.inscription)).payload))
    expect(reg).toMatchObject({ version: SCHEMA.version, id: "N01", kind: "station", lat: 35.13512, lon: -5.21534 })
    expect(reg.fields.map((f) => f.name)).toEqual(SCHEMA.layouts.station.fields)
    expect(reg.fields.find((f) => f.name === "temp")).toMatchObject({ u: "Cel", scale: 10 })
    expect(reg.bits).toEqual(["flame"])
  })

  it("rejette une version de schéma inconnue", () => {
    const obj = encodeInscription("N01", "station", 35.1, -5.2)
    obj[0] = 99
    expect(() => decodeInscription(obj)).toThrow(/version/)
  })

  it("rejette une unité incompatible avec le canal", () => {
    const obj = encodeInscription("N01", "temp", 35.1, -5.2)
    obj[6][0] = SCHEMA.units["%RH"]   // température annoncée en %RH
    expect(() => decodeInscription(obj)).toThrow(/unité incompatible/)
  })

  it("rejette un type inconnu ou un identifiant invalide", () => {
    const a = encodeInscription("N01", "temp", 35.1, -5.2)
    a[2] = 77
    expect(() => decodeInscription(a)).toThrow(/type/)
    const b = encodeInscription("N01", "temp", 35.1, -5.2)
    b[1] = "urn:dev:fw:x"
    expect(() => decodeInscription(b)).toThrow(/identifiant/)
  })
})

describe("Mesures compactes (FPort 2)", () => {
  const regStation = decodeInscription(encodeInscription("N01", "station", 35.135, -5.215))

  it("décode les mesures Python dans les unités physiques", () => {
    const { readings, fields } = decodeMeasures(regStation, decode(parsePhy(hex(PY.mesures)).payload))
    expect(readings).toMatchObject({
      temp: 25.3, hum: 32, smoke: 27, co: 2.1, ir: 0.01, flame: true,
      wind_speed: 9.4, wind_dir: 92, gust: 12.1, fmc: 8.4, rain: 0, bat: 87,
    })
    expect(fields[0]).toMatchObject({ pos: 0, n: "temp", raw: 253, scale: 10, v: 25.3, u: "Cel" })
  })

  it("décode la caméra thermique, azimut compris", () => {
    const reg = decodeInscription(decode(parsePhy(hex(PY.camInscription)).payload))
    const { readings } = decodeMeasures(reg, decode(parsePhy(hex(PY.camMesures)).payload))
    expect(readings).toEqual({ tmax: 212.4, hot_bearing: 132, hot_px: 37, azimuth: 136, bat: 64 })
  })

  it("garde les valeurs hors plage (pics) pour la détection de santé", () => {
    const { readings } = decodeMeasures(regStation, encodeMeasures("station", { ...WORST, temp: 420, smoke: 40000 }))
    expect(readings.temp).toBe(420)
    expect(readings.smoke).toBe(40000)
  })

  it("rejette un tableau de mauvaise longueur, une valeur non entière ou un objet", () => {
    expect(() => decodeMeasures(regStation, [1, 2, 3])).toThrow(/3 valeurs au lieu de 12/)
    const arr = encodeMeasures("station", WORST)
    arr[2] = 12.5
    expect(() => decodeMeasures(regStation, arr)).toThrow(/non entière/)
    expect(() => decodeMeasures(regStation, { temp: 250 })).toThrow(/tableau attendu/)
  })

  it.each(Object.keys(SCHEMA.layouts))("« %s » tient dans 51 o (SF10-12) avec des valeurs extrêmes", (kind) => {
    const bytes = encode(encodeMeasures(kind, WORST)).length
    expect(bytes).toBeLessThanOrEqual(maxPayload(12))
    const insc = encode(encodeInscription("D999", kind, -35.12345, -175.12345)).length
    expect(insc).toBeLessThanOrEqual(maxPayload(12))
  })
})

describe("Reconstruction SenML", () => {
  it("produit un SenML complet : bn, unités, position inscrite, métadonnées radio", () => {
    const reg = decodeInscription(encodeInscription("S07", "smoke", 35.14, -5.2))
    const { readings } = decodeMeasures(reg, encodeMeasures("smoke", { smoke: 512, hum: 41, bat: 77 }))
    const senml = labelSenml(buildSenml(reg, readings, { ts: 1_700_000_000_000, rssi: -101, snr: 3.5, sf: 10, fcnt: 42, gw: "G02" }))
    expect(senml[0]).toEqual({ bn: "urn:dev:fw:S07:", bt: 1_700_000_000, n: "lat", u: "lat", v: 35.14 })
    expect(senml).toContainEqual({ n: "lon", u: "lon", v: -5.2 })
    expect(senml).toContainEqual({ n: "smoke", u: "ppm", v: 512 })
    expect(senml).toContainEqual({ n: "hum", u: "%RH", v: 41 })
    expect(senml).toContainEqual({ n: "bat", u: "%EL", v: 77 })
    expect(senml).toContainEqual({ n: "rssi", u: "dBm", v: -101 })
    expect(senml).toContainEqual({ n: "seq", u: "1", v: 42 })
    expect(senml).toContainEqual({ n: "gw", vs: "G02" })
  })

  it("le format compact est bien plus petit que SenML/CBOR, lui-même plus petit que JSON", () => {
    const reg = decodeInscription(encodeInscription("N01", "station", 35.135, -5.215))
    const r = { temp: 25.3, hum: 32, smoke: 27, co: 2.1, ir: 0.01, flame: false, wind_speed: 9.4, wind_dir: 92, gust: 12.1, fmc: 8.4, rain: 0, bat: 87 }
    const compact = encode(encodeMeasures("station", r)).length
    const { senmlCbor, json } = senmlSizes(buildSenml(reg, r, { ts: Date.now() }))
    expect(compact).toBeLessThan(senmlCbor / 4)
    expect(senmlCbor).toBeLessThan(json)
  })
})

describe("Airtime et duty cycle", () => {
  it("airtime conforme à la formule Semtech (SF7 et SF12)", () => {
    // 34 o de PHYPayload : 77,1 ms en SF7, 1,81 s en SF12 (BW 125 kHz, CR 4/5, CRC)
    expect(airtimeMs(34, 7)).toBeCloseTo(77.1, 0)
    expect(airtimeMs(34, 12)).toBeCloseTo(1810.4, 0)
  })

  it("1 % de duty cycle : 99 × l'airtime de silence", () => {
    expect(minIntervalS(100)).toBeCloseTo(9.9, 6)
  })
})

describe("Serveur réseau", () => {
  let ns
  beforeEach(() => { ns = createNetworkServer() })

  it("inscription puis mesures : SenML reconstruit et tailles comparées", () => {
    const a = ns.handleUplink(env(hex(PY.inscription)), { now: 1000, timeFactor: 15 })
    expect(a).toMatchObject({ type: "inscription", id: "N01" })
    const b = ns.handleUplink(env(hex(PY.mesures)), { now: 2000, timeFactor: 15 })
    expect(b.type).toBe("mesures")
    expect(b.readings.smoke).toBe(27)
    expect(b.senml[0].bn).toBe("urn:dev:fw:N01:")
    expect(b.sizes.compact).toBeLessThan(b.sizes.senmlCbor)
    expect(b.sizes.senmlCbor).toBeLessThan(b.sizes.json)
    expect(b.sizes.phy).toBe(b.sizes.compact + SCHEMA.overheadBytes)
    expect(b.oversize).toBe(false)
    expect(b.dutyPct).toBeGreaterThan(0)
    // SF9, 34 o : ~247 ms d'airtime → ~24 s simulées de silence → ~1,6 s réelles à ×15
    expect(b.minPeriodS).toBeCloseTo(minIntervalS(airtimeMs(34, 9)) / 15, 6)
  })

  it("mesures d'un appareil non inscrit : rejet avec demande de réinscription", () => {
    try {
      ns.handleUplink(env(hex(PY.mesures)))
      expect.unreachable()
    } catch (e) {
      expect(e.code).toBe("inconnu")
      expect(e.rejoin).toBe(true)
    }
  })

  it("rejette une enveloppe sans trame, un SF invalide, un CBOR illisible, un FPort inconnu", () => {
    expect(() => ns.handleUplink({ gw: "G01", sf: 9 })).toThrow(/phy/)
    expect(() => ns.handleUplink(env(hex(PY.mesures), { sf: 6 }))).toThrow(/étalement/)
    const bad = buildPhy({ devAddr: PY.devAddr, fcnt: 1, fport: 2, payload: Buffer.from([0xff, 0xfe]) })
    expect(() => ns.handleUplink(env(bad))).toThrow(/CBOR/)
    const port = buildPhy({ devAddr: PY.devAddr, fcnt: 1, fport: 9, payload: encode([1]) })
    expect(() => ns.handleUplink(env(port))).toThrow(/FPort 9/)
  })

  it("SenML complet (FPort 3) : accepté, signalé hors charge utile au-delà du SF", () => {
    const pack = [{ [-2]: "urn:dev:fw:N05:", [-3]: 1_700_000_000, 0: "lat", 1: "lat", 2: 35.1 }, { 0: "lon", 1: "lon", 2: -5.2 }]
    for (let i = 0; i < 12; i++) pack.push({ 0: `canal_${i}`, 1: "ppm", 2: 1234.567 })
    const phy = buildPhy({ devAddr: 0x26000005, fcnt: 3, fport: 3, payload: encode(pack) })
    const up = ns.handleUplink(env(phy, { sf: 10 }))
    expect(up.type).toBe("senml")
    expect(up.id).toBe("N05")
    expect(up.oversize).toBe(true)
    expect(up.senml).toContainEqual({ n: "gw", vs: "G01" })
  })
})

describe("Downlink CoAP", () => {
  it("map CBOR standard à clés entières, lisible par le simulateur", () => {
    expect(Buffer.from(encodeDownlink({ period: 10, siren: false })).toString("hex")).toBe("a2010a0200")
    expect(Buffer.from(encodeDownlink({ rejoin: true })).toString("hex")).toBe("a10401")
    expect(decode(encodeDownlink({ period: 2.5, siren: true }))).toEqual({ 1: 2.5, 2: 1 })
  })
})
