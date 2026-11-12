"""
Station complète (ESP32 + LoRa SX1276) : tous les capteurs de base.
Modèle : DHT22 (temp, hum), MQ-2 (fumée), MQ-7 (CO), KY-026 (flamme),
         anémomètre + girouette (vent), GPS NEO-6M (lat/lon), batterie.
"""
from __future__ import annotations

import math
import random

from .base import Device


class Station(Device):
    kind = "station"

    def __init__(self, device_id, lat, lon, period):
        super().__init__(device_id, lat, lon, period)
        self._temp_offset = random.gauss(0, 1.5)   # biais individuel ±1.5°C

    def read_sensors(self, world):
        """Calcule les mesures en fonction de l'état du monde (CA + météo)."""
        w = world.weather
        heat, smoke_exp = world.fire_exposure(self.lat, self.lon)

        # Température : base météo + hausse si feu proche + cycle jour/nuit + biais + bruit
        temp = (w["temp"] + self._temp_offset
                + heat * 45
                + self._rng.gauss(0, 0.4))

        # Humidité : chute si feu, bruit
        hum = max(3.0, w["hum"] - heat * 15 + self._rng.gauss(0, 0.8))

        # Fumée MQ-2 (ppm) : panache gaussien ; sensibilité croisée humidité > 85 %
        base_smoke = 25 + smoke_exp * 1800 + self._rng.gauss(0, 4)
        if hum > 85:
            base_smoke *= 1.4   # MQ-2 réagit à l'humidité
        smoke = max(0.0, base_smoke)

        # CO MQ-7 (ppm)
        co = max(0.0, 2 + smoke_exp * 290 + self._rng.gauss(0, 0.6))

        # Flamme KY-026 (IR)
        flame = heat > 0.75
        ir = min(1.0, heat * 1.1 + self._rng.gauss(0, 0.03))

        # Vent local : vent global ± rafales ± bruit directionnel
        gust_add = self._rng.gauss(0, w.get("gust", w["wind_speed"] * 0.3) * 0.2)
        wind_speed = max(0.0, w["wind_speed"] + gust_add + self._rng.gauss(0, 0.4))
        wind_dir   = (w["wind_dir"] + self._rng.gauss(0, 7)) % 360

        # FMC (humidité du combustible) : approximation
        fmc = max(3.0, w.get("fmc", 20.0) + self._rng.gauss(0, 1))

        # Pluie
        rain = max(0.0, w.get("rain", 0.0) + self._rng.gauss(0, 0.1))

        readings = {
            "temp": round(temp, 1),
            "hum":  round(hum, 1),
            "smoke": round(smoke, 0),
            "co":   round(co, 1),
            "flame": flame,
            "ir":   round(max(0.0, ir), 3),
            "wind_speed": round(wind_speed, 1),
            "wind_dir":   round(wind_dir, 0),
            "fmc":  round(fmc, 1),
            "rain": round(rain, 1),
        }
        return self._apply_fault(readings)
