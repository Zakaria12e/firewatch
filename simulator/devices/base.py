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
    fuel, rain, siren, gateway).
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
    # Radio simulée (LoRaWAN simplifié)
    # ------------------------------------------------------------------
    def rssi_snr(self, gateways, elev_fn):
        """
        Calcule RSSI (dBm) et SNR (dB) vers la passerelle la plus proche.
        Perte en log-distance : PL = PL0 + 10·n·log10(d/d0).
        Atténuation supplémentaire si relief bloque la ligne de vue.
        """
        if not gateways:
            return -120.0, -20.0
        best_rssi = -200.0
        best_snr  = -30.0
        for gw in gateways:
            dist = _dist_m(self.lat, self.lon, gw["lat"], gw["lon"])
            dist = max(dist, 1.0)
            pl0 = 128.0           # perte à 1 m (EU868, 125 kHz SF7)
            n   = 2.8             # exposant de path-loss en forêt
            pl  = pl0 + 10 * n * math.log10(dist)
            # Pénalité relief (heuristique : pas de calcul Fresnel complet)
            penalty = 0.0
            if elev_fn:
                try:
                    h_dev = elev_fn(self.lat, self.lon)
                    h_gw  = elev_fn(gw["lat"], gw["lon"])
                    h_mid = elev_fn((self.lat + gw["lat"]) / 2,
                                    (self.lon + gw["lon"]) / 2)
                    los_mid = (h_dev + h_gw) / 2
                    if h_mid > los_mid + 20:
                        penalty = min(40.0, (h_mid - los_mid) * 0.3)
                except Exception:
                    pass
            rssi = -pl - penalty + self._rng.gauss(0, 2.0)
            snr  = max(-20.0, rssi + 100 + self._rng.gauss(0, 1.5))
            if rssi > best_rssi:
                best_rssi = rssi
                best_snr  = snr
        return round(best_rssi, 1), round(best_snr, 1)

    def sf_from_snr(self, snr):
        """ADR simplifié : choisit le SF selon le SNR (meilleur signal = SF bas = airtime court)."""
        if snr > 7:   return 7
        if snr > 2:   return 8
        if snr > -2:  return 9
        if snr > -7:  return 10
        if snr > -12: return 11
        return 12

    def packet_loss(self, snr):
        """Probabilité de perte du paquet selon le SNR."""
        if snr > -5:  return 0.0
        if snr > -12: return 0.1
        if snr > -17: return 0.4
        return 0.9

    # ------------------------------------------------------------------
    # Consommation batterie
    # ------------------------------------------------------------------
    def consume_battery(self, sf):
        # Airtime proportionnel à 2^SF, coût = 0.005 % par message au SF7
        cost = 0.005 * (2 ** (sf - 7))
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
            k = self._rng.choice([k for k in readings if isinstance(readings[k], (int, float))])
            readings[k] = readings[k] * self._rng.uniform(5, 20)
        if self.fault == "noisy":
            for k in readings:
                if isinstance(readings[k], float):
                    readings[k] += self._rng.gauss(0, readings[k] * 0.3 + 1)
        return readings

    # ------------------------------------------------------------------
    # Construction du paquet SenML
    # ------------------------------------------------------------------
    def build_senml(self, readings, rssi, snr, sf):
        self._seq += 1
        pack = [
            {BN: "urn:dev:fw:{}:".format(self.id), BT: int(time.time()),
             N: "lat", U: "lat", V: round(self.lat, 6)},
            {N: "lon", U: "lon", V: round(self.lon, 6)},
            {N: "bat", U: "%EL", V: round(self.battery, 1)},
            {N: "rssi", U: "dBm", V: rssi},
            {N: "snr",  U: "dB",  V: snr},
            {N: "sf",   U: "1",   V: sf},
            {N: "seq",  U: "1",   V: self._seq},
        ]
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
        }


# ---------------------------------------------------------------------------
# Utilitaires géo
# ---------------------------------------------------------------------------
def _dist_m(lat1, lon1, lat2, lon2):
    dlat = (lat2 - lat1) * 111_320
    dlon = (lon2 - lon1) * 111_320 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dlat, dlon)
