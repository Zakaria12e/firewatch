import { CENTER } from "./config.js"

let cache = { data: null, at: 0 }
const TTL = 10 * 60_000

/** Météo réelle au centre de la forêt (Open-Meteo, sans clé API). */
export async function getWeather() {
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
      },
    }
  } catch {
    // pas d'Internet : on garde l'ancienne valeur (ou null)
  }
  return cache.data
}
