/** Mesures lisibles d'un appareil selon son type (tooltip carte, tiroir Appareils). */
import type { NodeReadings } from "@/types"

export type Measurement = { label: string; value: string; unit: string }

export function getReadings(kind: string, r: NodeReadings): Measurement[] {
  const m: Measurement[] = []
  const add = (label: string, v: number | undefined, unit: string, digits = 1) => {
    if (v !== undefined) m.push({ label, value: v.toFixed(digits), unit })
  }
  switch (kind) {
    case "station":
      add("Température", r.temp, "°C", 1); add("Humidité", r.hum, "%", 0)
      add("Fumée", r.smoke, "ppm", 0); add("CO", r.co, "ppm", 0); break
    case "temp":
      add("Température", r.temp, "°C", 1); add("Humidité", r.hum, "%", 0); break
    case "smoke":
      add("Fumée", r.smoke, "ppm", 0); add("Humidité", r.hum, "%", 0); break
    case "co":
      add("CO", r.co, "ppm", 0); break
    case "flame":
      if (r.ir !== undefined) m.push({ label: "IR", value: r.ir.toFixed(2), unit: "" })
      if (r.flame !== undefined) m.push({ label: "Flamme", value: r.flame ? "Oui" : "Non", unit: "" }); break
    case "thermal":
      add("T. max", r.tmax, "°C", 1)
      add("Relèvement", r.hot_bearing, "°", 0)
      add("Pixels chauds", r.hot_px, "", 0); break
    case "wind":
      add("Vitesse", r.wind_speed, "m/s"); add("Direction", r.wind_dir, "°", 0)
      add("Rafale", r.gust, "m/s"); break
    case "fuel":
      add("FMC", r.fmc, "%", 1); break
    case "rain":
      add("Pluie", r.rain, "mm/h"); break
    case "gateway":
      add("Paquets reçus", r.rx, "", 0); add("RSSI moyen", r.rssi_avg, "dBm", 0); break
    case "siren":
      if (r.on !== undefined) m.push({ label: "Sirène", value: r.on ? "En marche" : "Arrêt", unit: "" }); break
  }
  return m
}
