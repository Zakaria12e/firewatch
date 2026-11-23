"""
Station complète (ESP32 + LoRa SX1276) : tous les capteurs de base.
Modèle : DHT22 (temp, hum), MQ-2 (fumée), MQ-7 (CO), KY-026 (flamme),
         anémomètre + girouette (vent), GPS NEO-6M (lat/lon), batterie.
"""
from __future__ import annotations

import random

from .base import Device


class Station(Device):
    kind = "station"

    def __init__(self, device_id, lat, lon, period, azimuth=0.0):
        super().__init__(device_id, lat, lon, period, azimuth)
        self._temp_offset = random.gauss(0, 1.5)   # biais individuel ±1.5°C

    def raw_readings(self, world):
        """Mesures physiques (sans panne) en fonction de l'état du monde (CA + météo)."""
        w = world.weather
        heat, smoke_exp = world.fire_exposure(self.lat, self.lon)
        # Fausses sources (brûlage, barbecue, véhicule, brouillard, soleil) : même physique
        fx = world.false_exposure(self.lat, self.lon)
        heat = min(1.0, heat + fx["heat"])
        smoke_exp = min(1.0, smoke_exp + fx["smoke"])

        # Température : base météo + hausse si feu proche + soleil sur le boîtier + bruit
        temp = (w["temp"] + self._temp_offset
                + heat * 45 + fx["temp_c"]
                + self._rng.gauss(0, 0.4))

        # Humidité : chute si feu, plancher en brouillard, bruit
        hum = w["hum"] - heat * 15 - fx["temp_c"] * 0.6 + self._rng.gauss(0, 0.8)
        if fx["hum_floor"] > hum:
            hum = fx["hum_floor"] + self._rng.gauss(0, 1.0)
        hum = max(3.0, min(100.0, hum))

        # Fumée MQ-2 (ppm) : panache gaussien ; sensibilité croisée à la condensation
        # (humidité > 88 %) : le capteur lit une fausse fumée sans CO
        base_smoke = 25 + smoke_exp * 1800 + self._rng.gauss(0, 4)
        if hum > 88:
            base_smoke = base_smoke * 1.4 + 160 * (hum - 88) / 12
        smoke = max(0.0, base_smoke)

        # CO MQ-7 (ppm) : combustion + gaz d'échappement
        co = max(0.0, 2 + smoke_exp * 290 + fx["co_ppm"] + self._rng.gauss(0, 0.6))

        # Flamme KY-026 (IR)
        flame = heat > 0.75
        ir = min(1.0, heat * 1.1 + self._rng.gauss(0, 0.03))

        # Vent local : vent global ± rafales ± bruit directionnel
        gust_ref = w.get("gust", w["wind_speed"] * 1.3)
        gust_add = self._rng.gauss(0, w.get("gust", w["wind_speed"] * 0.3) * 0.2)
        wind_speed = max(0.0, w["wind_speed"] + gust_add + self._rng.gauss(0, 0.4))
        wind_dir   = (w["wind_dir"] + self._rng.gauss(0, 7)) % 360
        gust = max(wind_speed, gust_ref + self._rng.gauss(0, 0.8))

        # FMC (humidité du combustible) : approximation
        fmc = max(3.0, w.get("fmc", 20.0) + self._rng.gauss(0, 1))

        # Pluie
        rain = max(0.0, w.get("rain", 0.0) + self._rng.gauss(0, 0.1))

        return {
            # DHT22 : plage −40…80 °C, la mesure sature au-delà (les pannes, appliquées
            # ensuite, peuvent encore produire des valeurs aberrantes)
            "temp": round(max(-40.0, min(80.0, temp)), 1),
            "hum":  round(hum, 1),
            "smoke": round(smoke, 0),
            "co":   round(co, 1),
            "flame": flame,
            "ir":   round(max(0.0, ir), 3),
            "wind_speed": round(wind_speed, 1),
            "wind_dir":   round(wind_dir, 0),
            "gust": round(gust, 1),
            "fmc":  round(fmc, 1),
            "rain": round(rain, 1),
        }

    def read_sensors(self, world):
        return self._apply_fault(self.raw_readings(world))
