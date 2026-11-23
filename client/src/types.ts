export type AlertLevel =
  | "veille"
  | "vigilance"
  | "suspicion"
  | "pré-alerte"
  | "feu_confirmé"
  | "maîtrisé"

export type NodeFault =
  | "ok"
  | "hors_ligne"
  | "figé"
  | "aberrant"
  | "batterie_faible"
  | "dérive"

export type DeviceKind =
  | "station"
  | "temp"
  | "smoke"
  | "co"
  | "flame"
  | "thermal"
  | "wind"
  | "fuel"
  | "rain"
  | "siren"
  | "gateway"

export type FaultMode =
  | "ok"
  | "offline"
  | "battery"
  | "stuck"
  | "drift"
  | "spike"
  | "noisy"

export type WeatherMode = "reel" | "manuel" | "prevision"

export interface NodeReadings {
  temp?: number
  hum?: number
  smoke?: number
  co?: number
  flame?: boolean
  wind_speed?: number
  wind_dir?: number
  bat?: number
  ir?: number
  tmax?: number
  fmc?: number
  rain?: number
  gust?: number
  rssi?: number
  snr?: number
  hot_bearing?: number
  hot_px?: number
  rx?: number
  rssi_avg?: number
  on?: boolean
}

export interface SenmlRecord {
  bn?: string
  bt?: number
  n?: string
  u?: string
  v?: number
  vs?: string
  vb?: boolean
}

/** En-tête de la trame LoRaWAN (PHYPayload) telle que découpée par le serveur réseau. */
export interface LoraFrame {
  mhdr: number
  confirmed: boolean
  devAddr: string
  fctrl: number
  fcnt: number
  fport: number
  headerBytes: number
  mic: string
}

/** Position du tableau compact : valeur brute × échelle → valeur physique. */
export interface DecodedField {
  pos: number
  n: string
  raw: number | null
  scale: number
  v: number | string | null
  u: string
}

/** Tailles du même contenu : SenML JSON → SenML/CBOR → CBOR compact → trame LoRaWAN. */
export interface PacketSizes {
  json?: number
  senmlCbor?: number
  compact?: number
  phy?: number
}

export interface LastPacket {
  /** inscription (FPort 1), mesures compactes (2), SenML complet (3) ou backhaul de passerelle */
  type: "inscription" | "mesures" | "senml" | "backhaul"
  hex: string
  senml?: SenmlRecord[]
  frame?: LoraFrame
  radio?: { gw: string; rssi: number; snr: number; sf: number; freq?: number }
  fields?: DecodedField[]
  sizes: PacketSizes
  airtimeMs?: number
  maxPayload?: number
  oversize?: boolean
  /** part de l'heure glissante (temps simulé) passée à émettre, % */
  dutyPct?: number
  /** période minimale imposée par le duty cycle (s réelles) */
  minPeriodS?: number
  /** secondes simulées par seconde réelle */
  timeFactor?: number
  downlink?: { period: number; siren: boolean; hex: string; bytes: number }
}

export interface InscriptionInfo extends Omit<LastPacket, "fields"> {
  version: number
  kind: DeviceKind
  lat: number
  lon: number
  fields: { name: string; u: string; scale: number }[]
  bits: string[]
  at: number
}

export interface FireNode {
  id: string
  /** type annoncé dans l'inscription LoRaWAN */
  kind?: DeviceKind
  lat: number
  lon: number
  ts: number
  readings: NodeReadings
  /** statut brut des capteurs (ok / suspect / feu) */
  status: NodeFault | "suspect" | "feu"
  /** santé calculée par le pipeline (§6.2) */
  health?: NodeFault
  risk: { value: number | null }
  period: number
  bytes: number
  online: boolean
  siren: boolean
  gw?: string | null
  seq?: number
  sf?: number
  lastPacket?: LastPacket
  inscription?: InscriptionInfo
}

export interface Zone {
  minutes: number
  polygon: [number, number][]
}

export interface ThreatenedPlace {
  name: string
  distance: number
  eta: number
  lat: number
  lon: number
}

export interface TimelineEvent {
  type: AlertLevel
  at: number
}

export interface Incident {
  id: string
  status: "actif" | "maîtrisé"
  level: AlertLevel
  score: number
  confirmed: boolean
  startedAt: number
  updatedAt?: number
  endedAt?: number
  position?: { lat: number; lon: number; uncertainty_m?: number }
  heading?: number
  rosMPerMin?: number
  zones?: Zone[]
  threatenedNodes?: string[]
  threatenedPlaces?: ThreatenedPlace[]
  areaHa?: number
  suspects: string[]
  alertsSent?: string[]
  reason?: string
  timeline?: TimelineEvent[]
}

export interface DetectionThresholds {
  smokePpm: number
  coPpm: number
  tempRisePerMin: number
  humDropPerMin: number
  irHot: number
  tmaxHot: number
}

export interface FusionWeights {
  weightFlame: number
  weightThermal: number
  weightSmoke: number
  weightCO: number
  weightTempRise: number
  weightHumDrop: number
  minConfirmScore: number
  minPreAlertScore: number
  minSuspicionScore: number
}

/** Zone de brûlage agricole déclarée : polygone [[lat, lon], …] */
export interface BurnZone {
  id: string
  name: string
  polygon: [number, number][]
  center?: { lat: number; lon: number }
  radius?: number
}

export interface AppSettings {
  thresholds: DetectionThresholds
  fusion: FusionWeights
  alerts: { ntfyEnabled: boolean; pushoverEnabled: boolean }
  burnZones: BurnZone[]
}

export interface AlertChannels {
  ntfy: { configured: boolean; topic: string | null; enabled: boolean }
  pushover: { configured: boolean; enabled: boolean }
}

export interface Weather {
  temp: number
  hum: number
  wind_speed: number
  wind_dir: number
  fmc?: number
  mode?: WeatherMode
}

export interface WorldDevice {
  id: string
  kind: DeviceKind
  lat: number
  lon: number
  azimuth: number
  fault: FaultMode
  /** état physique de la sirène / du relais de l'appareil */
  siren?: boolean
}

export interface WorldFire {
  id: string
  start: number
  startEpochMs?: number
  origin?: { r: number; c: number }
  parent?: string | null
  cells: { r: number; c: number }[]
}

export interface WorldWeather extends Weather {
  gust?: number
  rain?: number
}

export interface WorldState {
  grid?: { cells: string; rows: number; cols: number; cell: number; origin?: { lat: number; lon: number } }
  fires?: WorldFire[]
  /** cellules en feu : [ligne, colonne, intensité 0-100] */
  burning?: [number, number, number][]
  /** sautes de feu depuis le dernier snapshot */
  spots?: { id: number; from: [number, number]; to: [number, number]; fire?: string }[]
  /** largages Canadair : impactIn = secondes avant l'impact (négatif = passé) */
  drops?: { id: number; lat: number; lon: number; radius: number; impactIn: number }[]
  weather?: WorldWeather
  devices?: WorldDevice[]
  radio?: { sent: number; lost: number }
  timeScale?: number
  speed?: number
  simTime?: number
}

export interface FireWatchState {
  nodes: FireNode[]
  incident: Incident | null
  weather: Weather | null
  weatherMode: WeatherMode
  store: string
  center: { lat: number; lon: number }
  places: { name: string; lat: number; lon: number }[]
  sirenOverride: boolean | null
  simulatorConnected: boolean
}

export interface AlertLevelPayload {
  level: AlertLevel
  score: number
  riskIndex: { value: number }
  wind?: { speed: number; from: number }
}

export interface DetectionEvent {
  startMs: number
  suspicionMs: number | null
  confirmationMs: number | null
}

export interface ScenarioBenchResult {
  scenario: string
  description: string
  runs: { run: number; detected: boolean; det_time_s: number | null; cbor_savings_pct: number }[]
  detection_rate: number
  avg_det_time_s: number | null
  avg_cbor_savings_pct: number
}

export interface Metrics {
  detection: {
    events: DetectionEvent[]
    confirmTimes: number[]
    suspTimes: number[]
    avgConfirmS: number | null
    avgSuspS: number | null
    count: number
  }
  falseAlerts: { avoided: number }
  network: {
    packetsReceived: number
    pdr: number
    frames: number
    inscriptions: number
    backhaul: number
    airtimeMsTotal: number
    avgAirtimeMs: number
    sfHistogram: Record<string, number>
    oversize: number
    rejected: Record<string, number>
    dutyCycle: { limitPct: number; avgPct: number; maxPct: number; maxId: string | null }
  }
  data: {
    savingsPct: number
    cborSavingsPct: number
    compactVsSenmlPct: number
    measureFrames: number
    avgJson: number
    avgSenmlCbor: number
    avgCompact: number
    avgPhy: number
    cborBytes: number
    jsonEstBytes: number
    avgPacketCbor: number
  }
  health: { online: number; total: number }
  scenarios: ScenarioBenchResult[]
}
