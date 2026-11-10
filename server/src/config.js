import "dotenv/config"

export const config = {
  httpPort: Number(process.env.HTTP_PORT || 3000),
  coapPort: Number(process.env.COAP_PORT || 5683),
  mongoUri: process.env.MONGO_URI || "mongodb://127.0.0.1:27017/firewatch",
  ntfyTopic: process.env.NTFY_TOPIC || "",
  pushoverToken: process.env.PUSHOVER_TOKEN || "",
  pushoverUser: process.env.PUSHOVER_USER || "",
  // La démo est accélérée : 1 minute de simulation = TIME_SCALE minutes réelles
  timeScale: Number(process.env.TIME_SCALE || 15),
  periodNormal: Number(process.env.PERIOD_NORMAL || 10), // s entre deux envois
  periodAlert: Number(process.env.PERIOD_ALERT || 2),    // s en cas de danger
}

// Centre de la forêt surveillée (Talassemtane, Chefchaouen)
export const CENTER = { lat: 35.135, lon: -5.215 }

// Lieux habités à protéger
export const PLACES = [
  { name: "Chefchaouen", lat: 35.1714, lon: -5.2697 },
  { name: "Akchour", lat: 35.237, lon: -5.175 },
  { name: "Bab Taza", lat: 35.0547, lon: -5.1981 },
]
