import { CENTER } from "./config.js"

let cache = { data: null, at: 0 }
const TTL = 10 * 60_000

/** Mode courant : "reel" | "manuel" | "prevision" */
let weatherMode = "reel"

/** Météo manuelle (utilisée en mode "manuel") */
let manualWeather = { temp: 22, hum: 55, wind_speed: 4, wind_dir: 240, fmc: 20 }

const PRESETS = {
  chergui: { temp: 35, hum: 15, wind_speed: 12, wind_dir: 100, fmc: 5 },
  normal:  { temp: 22, hum: 55, wind_speed: 4,  wind_dir: 240, fmc: 20 },
  pluie:   { temp: 14, hum: 90, wind_speed: 2,  wind_dir: 270, fmc: 55 },
  nuit:    { temp: 15, hum: 70, wind_speed: 2,  wind_dir: 180, fmc: 25 },
}

export function getWeatherMode() { return weatherMode }

export function setWeatherMode(mode) {
  if (["reel", "manuel", "prevision"].includes(mode)) weatherMode = mode
}

export function setManualWeather(w) {
  manualWeather = { ...manualWeather, ...w }
}

export function applyPreset(name) {
  if (PRESETS[name]) manualWeather = { ...PRESETS[name] }
}

/** Météo selon le mode actif. */
export async function getWeather() {
  if (weatherMode === "manuel") return { ...manualWeather, mode: "manuel" }

  if (cache.data && Date.now() - cache.at < TTL) return cache.data
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${CENTER.lat}&longitude=${CENTER.lon}` +
    "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation" +
    "&wind_speed_unit=ms"
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    const c = (await res.json()).current
    cache = {
      at: Date.now(),
      data: {
        temp: c.temperature_2m,
        hum: c.relative_humidity_2m,
        wind_speed: c.wind_speed_10m,
        wind_dir: c.wind_direction_10m,
        rain: c.precipitation,
        time: c.time,
        mode: "reel",
      },
    }
  } catch {
    // pas d'Internet : on garde l'ancienne valeur
  }
  return cache.data
}
