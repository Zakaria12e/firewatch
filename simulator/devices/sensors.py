"""
Appareils par type (§4) : chacun est indépendant (ID, batterie, radio, flux SenML)
et ne publie que les mesures de son capteur.
"""
from __future__ import annotations

import math

from .base import Device, _dist_m, bearing_deg
from .station import Station

# Canaux publiés par les capteurs simples (même physique que la station)
CHANNELS = {
    "temp":  ("temp", "hum"),                     # DHT22
    "smoke": ("smoke", "hum"),                    # MQ-2 (sensible à l'humidité)
    "co":    ("co",),                             # MQ-7
    "flame": ("flame", "ir"),                     # KY-026
    "wind":  ("wind_speed", "wind_dir", "gust"),  # anémomètre + girouette
    "fuel":  ("fmc",),                            # sonde d'humidité du combustible
    "rain":  ("rain",),                           # pluviomètre
}

KINDS = ("station", "temp", "smoke", "co", "flame", "thermal", "wind",
         "fuel", "rain", "siren", "gateway")


class SensorDevice(Station):
    """Capteur simple : réutilise la physique de la station, ne publie que ses canaux."""

    def __init__(self, kind, device_id, lat, lon, period, azimuth=0.0):
        super().__init__(device_id, lat, lon, period, azimuth)
        self.kind = kind

    def read_sensors(self, world):
        raw = self.raw_readings(world)
        keep = CHANNELS.get(self.kind, ())
        return self._apply_fault({k: raw[k] for k in keep if k in raw})


class ThermalCamera(Station):
    """
    Caméra thermique MLX90640 (32×24 px) orientable : cône de 110°, portée 800 m,
    bloquée par le relief. Publie le point le plus chaud vu dans le cône.
    """

    kind = "thermal"
    FOV_DEG = 110.0
    RANGE_M = 800.0
    MAST_M = 8.0

    def _visible(self, world, lat, lon):
        """Ligne de vue caméra → cellule (relief + canopée)."""
        try:
            h0 = world.elevation_at(self.lat, self.lon) + self.MAST_M
            h1 = world.elevation_at(lat, lon) + 6.0
            for i in range(1, 10):
                t = i / 10.0
                ground = world.elevation_at(self.lat + (lat - self.lat) * t,
                                            self.lon + (lon - self.lon) * t)
                if ground + 4.0 > h0 + (h1 - h0) * t:
                    return False
        except Exception:
            return True
        return True

    def read_sensors(self, world):
        w = world.weather
        ambient = w["temp"] + self._temp_offset
        half = self.FOV_DEG / 2.0
        tmax = ambient + 3.0 + self._rng.gauss(0, 0.5)   # sol chauffé, sans feu
        hot_bearing = self.azimuth
        hot_px = 0.0
        for r, c, intensity in world.fire.burning_intensity():
            lat, lon = world.cell_center(r, c)
            d = _dist_m(self.lat, self.lon, lat, lon)
            if d > self.RANGE_M:
                continue
            b = bearing_deg(self.lat, self.lon, lat, lon)
            diff = abs(((b - self.azimuth + 540.0) % 360.0) - 180.0)
            if diff > half or not self._visible(world, lat, lon):
                continue
            t = ambient + 25.0 + 450.0 * (intensity / 100.0) * math.exp(-d / 500.0)
            hot_px += min(48.0, 20.0 * (40.0 / max(d, 40.0)) ** 2 + 0.5)
            if t > tmax:
                tmax = t
                hot_bearing = b
        readings = {
            "tmax": round(min(300.0, tmax), 1),
            "hot_bearing": round(hot_bearing, 0),
            "hot_px": int(min(768, round(hot_px))),
        }
        return self._apply_fault(readings)


class Gateway(Device):
    """
    Passerelle LoRaWAN : relaie les uplinks reçus (radio.py) et publie ses propres
    statistiques par son backhaul (pas de liaison LoRa pour elle-même).
    """

    kind = "gateway"

    def __init__(self, device_id, lat, lon, period=30.0, azimuth=0.0):
        super().__init__(device_id, lat, lon, max(period, 30.0), azimuth)
        self.battery = 100.0   # alimentation secteur + batterie tampon
        self._rx = 0
        self._rssi_sum = 0.0

    def record_rx(self, rssi):
        self._rx += 1
        if rssi is not None:
            self._rssi_sum += rssi

    def consume_battery(self, airtime_ms):
        if self.fault == "battery":
            self.battery = max(0.0, self.battery - 2.0)

    def active(self):
        return self.fault != "offline" and self.battery > 1.0

    def read_sensors(self, world):
        n = self._rx
        readings = {"rx": n}
        if n:
            readings["rssi_avg"] = round(self._rssi_sum / n, 1)
        self._rx = 0
        self._rssi_sum = 0.0
        return self._apply_fault(readings)


class Siren(Device):
    """Sirène + relais : actionneur commandé par la réponse CoAP ({siren})."""

    kind = "siren"

    def read_sensors(self, world):
        return {"on": bool(self.siren)}


def create_device(kind, device_id, lat, lon, period, azimuth=0.0):
    """Fabrique un appareil du type demandé (station par défaut)."""
    if kind == "thermal":
        return ThermalCamera(device_id, lat, lon, period, azimuth)
    if kind == "gateway":
        return Gateway(device_id, lat, lon, period, azimuth)
    if kind == "siren":
        return Siren(device_id, lat, lon, period, azimuth)
    if kind in CHANNELS:
        return SensorDevice(kind, device_id, lat, lon, period, azimuth)
    return Station(device_id, lat, lon, period, azimuth)
