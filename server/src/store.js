import mongoose from "mongoose"

let useMongo = false
let Measurement, Incident
const memory = { measurements: [], incidents: new Map() }
const MEMORY_LIMIT = 20_000

export async function initStore(uri) {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 })
    Measurement = mongoose.model(
      "Measurement",
      new mongoose.Schema({
        node: { type: String, index: true },
        ts: { type: Date, index: true },
        temp: Number, hum: Number, smoke: Number, co: Number, flame: Boolean,
        wind_speed: Number, wind_dir: Number, bat: Number, lat: Number, lon: Number,
        status: String,
      })
    )
    Incident = mongoose.model(
      "Incident",
      new mongoose.Schema({ _id: String }, { strict: false, timestamps: true })
    )
    useMongo = true
    console.log("🗄️  MongoDB connecté")
  } catch {
    console.warn("⚠️  MongoDB indisponible : stockage en mémoire (les données seront perdues à l'arrêt)")
  }
}

export const storeMode = () => (useMongo ? "mongodb" : "mémoire")

export function saveMeasurement(m) {
  if (useMongo) return Measurement.create(m).catch((e) => console.error("Mongo:", e.message))
  memory.measurements.push(m)
  if (memory.measurements.length > MEMORY_LIMIT) memory.measurements.shift()
}

export async function history(node, limit = 90) {
  if (useMongo) {
    const rows = await Measurement.find({ node }).sort({ ts: -1 }).limit(limit).lean()
    return rows.reverse()
  }
  return memory.measurements.filter((m) => m.node === node).slice(-limit)
}

export function saveIncident(incident) {
  const doc = { ...incident, zones: undefined }
  if (useMongo)
    return Incident.updateOne({ _id: incident.id }, { $set: doc }, { upsert: true }).catch((e) =>
      console.error("Mongo:", e.message)
    )
  memory.incidents.set(incident.id, doc)
}

export async function listIncidents() {
  if (useMongo) return Incident.find().sort({ startedAt: -1 }).limit(20).lean()
  return [...memory.incidents.values()].sort((a, b) => b.startedAt - a.startedAt)
}
