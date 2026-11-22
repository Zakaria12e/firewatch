"""Classe de base pour tous les appareils IoT simulés."""
from __future__ import annotations

import math
import random
import time
from typing import Any, Dict, List, Optional

# Labels SenML à entiers (RFC 8428, section 6)
BN, BT, N, U, V, VS, VB = -2, -3, 0, 1, 2, 3, 4


def offset(lat, lon, north_m, east_m):
    dlat = north_m / 111_320
    dlon = east_m / (111_320 * math.cos(math.radians(lat)))
    return lat + dlat, lon + dlon


class Device:
    """
    Appareil IoT virtuel.
    Sous-classé par type (station, temp, smoke, co, flame, thermal, wind,
    fuel, rain, siren, gateway). La radio (RSSI, SNR, SF, passerelle) est
    calculée par engine/radio.py au moment de l'émission.
    """

    kind = "device"   # surcharge dans les sous-classes

    def __init__(self, device_id, lat, lon, period, azimuth=0.0):
        self.id = device_id
        self.lat = lat
        self.lon = lon
        self.period = period
        self.azimuth = azimuth       # orientation (caméra thermique)
        self.battery = random.uniform(85, 100)
        self.siren = False
        self.fault = "ok"            # ok | offline | battery | stuck | drift | spike | noisy
        self._next_send = time.time() + random.uniform(0, period)
        self._seq = 0
        self._stuck_readings = None  # valeurs figées (mode stuck)
        self._rng = random.Random()

    # ------------------------------------------------------------------
    # Pannes
    # ------------------------------------------------------------------
    def set_fault(self, mode):
        """Change le mode de panne ; remet à zéro les états liés à l'ancien mode."""
        if mode == self.fault:
            return
        self._stuck_readings = None
        if self.fault == "battery" and mode == "ok":
            self.battery = max(self.battery, 60.0)   # batterie remplacée
        self.fault = mode

    # ------------------------------------------------------------------
    # Consommation batterie
    # ------------------------------------------------------------------
    def consume_battery(self, sf):
        # Airtime proportionnel à 2^SF : ~0,0004 % de batterie par message au SF7
        # (≈ 0,013 % au SF12 : 2400 mAh, 40 mA pendant l'émission)
        cost = 0.0004 * (2 ** (sf - 7))
        self.battery = max(0.0, self.battery - cost)
        if self.fault == "battery":
            self.battery = max(0.0, self.battery - 0.5)

    # ------------------------------------------------------------------
    # Prêt à émettre ?
    # ------------------------------------------------------------------
    def ready(self, now):
        return now >= self._next_send and self.fault != "offline" and self.battery > 1.0

    def schedule_next(self, now):
        self._next_send = now + self.period

    # ------------------------------------------------------------------
    # Lecture des capteurs (à surcharger)
    # ------------------------------------------------------------------
    def read_sensors(self, world):
        """Retourne un dict de mesures brutes. Surcharger dans les sous-classes."""
        raise NotImplementedError

    def _apply_fault(self, readings):
        """Applique les modes de panne aux mesures."""
        if self.fault == "stuck":
            if self._stuck_readings is None:
                self._stuck_readings = dict(readings)
            return dict(self._stuck_readings)
        if self.fault == "drift":
            for k in readings:
                if isinstance(readings[k], float):
                    readings[k] += self._seq * self._rng.gauss(0, 0.1)
        if self.fault == "spike" and self._rng.random() < 0.1:
            keys = [k for k in readings
                    if isinstance(readings[k], (int, float)) and not isinstance(readings[k], bool)]
            if keys:
                k = self._rng.choice(keys)
                readings[k] = readings[k] * self._rng.uniform(5, 20)
        if self.fault == "noisy":
            for k in readings:
                if isinstance(readings[k], float):
                    readings[k] += self._rng.gauss(0, readings[k] * 0.3 + 1)
        return readings

    # ------------------------------------------------------------------
    # Construction du paquet SenML
    # ------------------------------------------------------------------
    def build_senml(self, readings, radio=None):
        """
        Paquet SenML à labels entiers.
        radio = (rssi, snr, sf) pour un uplink LoRa, None pour une liaison filaire
        (passerelle : backhaul Ethernet/4G).
        """
        self._seq += 1
        pack = [
            {BN: "urn:dev:fw:{}:".format(self.id), BT: int(time.time()),
             N: "lat", U: "lat", V: round(self.lat, 6)},
            {N: "lon", U: "lon", V: round(self.lon, 6)},
            {N: "bat", U: "%EL", V: round(self.battery, 1)},
        ]
        if radio is not None:
            rssi, snr, sf = radio
            pack.append({N: "rssi", U: "dBm", V: rssi})
            pack.append({N: "snr",  U: "dB",  V: snr})
            pack.append({N: "sf",   U: "1",   V: sf})
        pack.append({N: "seq", U: "1", V: self._seq})
        for key, val in readings.items():
            if isinstance(val, bool):
                pack.append({N: key, VB: val})
            elif isinstance(val, str):
                pack.append({N: key, VS: val})
            else:
                pack.append({N: key, V: round(float(val), 3)})
        return pack

    def to_dict(self):
        return {
            "id": self.id,
            "kind": self.kind,
            "lat": self.lat,
            "lon": self.lon,
            "azimuth": self.azimuth,
            "fault": self.fault,
            "siren": bool(self.siren),
        }


# ---------------------------------------------------------------------------
# Utilitaires géo
# ---------------------------------------------------------------------------
def _dist_m(lat1, lon1, lat2, lon2):
    dlat = (lat2 - lat1) * 111_320
    dlon = (lon2 - lon1) * 111_320 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dlat, dlon)


def bearing_deg(lat1, lon1, lat2, lon2):
    """Relèvement (0° = nord, sens horaire) de (lat1, lon1) vers (lat2, lon2)."""
    dlat = (lat2 - lat1) * 111_320
    dlon = (lon2 - lon1) * 111_320 * math.cos(math.radians((lat1 + lat2) / 2))
    return (math.degrees(math.atan2(dlon, dlat)) + 360.0) % 360.0
