const M_PER_DEG = 111_320

export function toLocal(p, ref) {
  return {
    north: (p.lat - ref.lat) * M_PER_DEG,
    east: (p.lon - ref.lon) * M_PER_DEG * Math.cos((ref.lat * Math.PI) / 180),
  }
}

export function offset(p, north, east) {
  return {
    lat: p.lat + north / M_PER_DEG,
    lon: p.lon + east / (M_PER_DEG * Math.cos((p.lat * Math.PI) / 180)),
  }
}

export function distance(a, b) {
  const { north, east } = toLocal(a, b)
  return Math.hypot(north, east)
}

export function bearing(from, to) {
  const { north, east } = toLocal(to, from)
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360
}

/** Point dans un polygone [[lat, lon], ...] (ray casting). */
export function inPolygon(p, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i]
    const [yj, xj] = poly[j]
    if (yi > p.lat !== yj > p.lat && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const DIRS = ["nord", "nord-est", "est", "sud-est", "sud", "sud-ouest", "ouest", "nord-ouest"]
export const compass = (deg) => DIRS[Math.round(deg / 45) % 8]
