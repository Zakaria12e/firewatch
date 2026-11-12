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
}

export interface FireNode {
  id: string
  lat: number
  lon: number
  ts: number
  readings: NodeReadings
  status: NodeFault
  risk: { value: number }
  period: number
  bytes: number
  online: boolean
  siren: boolean
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

export interface Incident {
  id: string
  status: "actif" | "maîtrisé"
  level: AlertLevel
  score: number
  confirmed: boolean
  startedAt: number
  updatedAt?: number
  endedAt?: number
  position?: { lat: number; lon: number }
  heading?: number
  rosMPerMin?: number
  zones?: Zone[]
  threatenedNodes?: string[]
  threatenedPlaces?: ThreatenedPlace[]
  areaHa?: number
  suspects: string[]
  alertsSent?: string[]
  reason?: string
}

export interface Weather {
  temp: number
  hum: number
  wind_speed: number
  wind_dir: number
  fmc?: number
}

export interface WorldDevice {
  id: string
  kind: DeviceKind
  lat: number
  lon: number
  azimuth: number
  fault: FaultMode
}

export interface WorldState {
  grid?: { cells: string; rows: number; cols: number; cell: number }
  fires?: { id: string; start: number; cells: [number, number][] }[]
  weather?: Weather
  devices?: WorldDevice[]
  timeScale?: number
  simTime?: number
}

export interface FireWatchState {
  nodes: FireNode[]
  incident: Incident | null
  weather: Weather | null
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
}
