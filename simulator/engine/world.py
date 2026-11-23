"""
Monde simulé : état global, file d'ordres, tick(dt).
Fait le lien entre la forêt, le feu, la météo et les appareils.
"""
from __future__ import annotations

import math
import time
from typing import Any, Dict, List, Optional

from .forest import (Forest, latlon_to_cell, cell_to_latlon, ROWS, COLS, CELL_M,
                     ORIGIN_LAT, ORIGIN_LON)
from .fire import FireModel
from .weather import PRESETS, default_weather

# Canadair : délai (secondes réelles) entre l'ordre et l'impact de l'eau, le temps
# que l'avion arrive sur zone (le dashboard anime l'approche à partir de impactIn).
DROP_DELAY_S = 6.0
DROP_KEEP_S = 8.0     # durée pendant laquelle un largage reste dans le snapshot


class World:
    def __init__(self, speed=1.0, real_weather=False, device_factory=None, default_period=10.0):
        """
        speed          : facteur de vitesse de simulation (1 = temps réel, >1 = accéléré).
        real_weather   : si True, tentera Open-Meteo au démarrage.
        device_factory : create_device(kind, id, lat, lon, period, azimuth) → Device.
        """
        self.speed = speed
        self.forest = Forest()
        self.fire = FireModel(self.forest)
        self.weather = default_weather()
        if real_weather:
            from .weather import fetch_real_weather
            w = fetch_real_weather()
            if w:
                self.weather = w
        self.devices = {}       # id → Device (objet appareil)
        self.device_factory = device_factory
        self.default_period = default_period
        self.time_scale = 15    # 1 min réelle = time_scale min simulées (pour affichage)
        self.sim_time = 0.0     # secondes simulées depuis le début
        self.drops = []         # largages Canadair [{id, lat, lon, radius, impact_at, done}]
        self.radio_stats = {"sent": 0, "lost": 0, "airtime_ms": 0.0, "oversize": 0}
        self._command_queue = []
        self._last_tick = time.time()
        self._device_id_counter = 0
        self._drop_counter = 0
        self._scheduled_commands = []   # [(sim_time_trigger, cmd)]

    # ------------------------------------------------------------------
    # Géométrie
    # ------------------------------------------------------------------
    def elevation_at(self, lat, lon):
        """Altitude (m) de la cellule qui contient (lat, lon), bornée à la grille."""
        r, c = latlon_to_cell(lat, lon)
        r = min(ROWS - 1, max(0, r))
        c = min(COLS - 1, max(0, c))
        return self.forest.elev[r][c]

    @staticmethod
    def cell_center(r, c):
        return cell_to_latlon(r, c)

    def active_gateways(self):
        return [d for d in self.devices.values()
                if d.kind == "gateway" and getattr(d, "active", lambda: True)()]

    # ------------------------------------------------------------------
    # Tick
    # ------------------------------------------------------------------
    def tick(self):
        """Avance la simulation d'un pas de temps depuis le dernier appel."""
        now = time.time()
        dt_real = now - self._last_tick
        self._last_tick = now
        dt_sim = dt_real * self.speed * self.time_scale
        self.sim_time += dt_sim
        self.fire.tick(dt_sim, self.weather)
        # Commandes programmées (scénarios avec délai)
        due = [(t, c) for (t, c) in self._scheduled_commands if self.sim_time >= t]
        for item in due:
            self._scheduled_commands.remove(item)
            self.apply_command(item[1])
        # Largages Canadair arrivés sur zone
        for d in self.drops:
            if not d["done"] and now >= d["impact_at"]:
                r, c = latlon_to_cell(d["lat"], d["lon"])
                self.fire.extinguish(r, c, d["radius"])
                d["done"] = True
        self.drops = [d for d in self.drops if now - d["impact_at"] < DROP_KEEP_S]

    # ------------------------------------------------------------------
    # Ordres
    # ------------------------------------------------------------------
    def enqueue(self, cmd):
        """Ajoute un ordre dans la file (depuis /api/world/command)."""
        self._command_queue.append(cmd)

    def drain_commands(self):
        """Vide la file et retourne les ordres ; appelé lors de la réponse à /api/sim/world."""
        cmds = list(self._command_queue)
        self._command_queue.clear()
        return cmds

    def apply_command(self, cmd):
        """Applique un ordre reçu du serveur dans la réponse à /api/sim/world."""
        t = cmd.get("type") or cmd.get("t")
        if t == "fire_start":
            r, c = latlon_to_cell(cmd["lat"], cmd["lon"])
            self.fire.ignite(r, c)
        elif t == "fire_move":
            # Déplacer le foyer = allumer une nouvelle cellule (l'ancien continue)
            r, c = latlon_to_cell(cmd["lat"], cmd["lon"])
            self.fire.ignite(r, c)
        elif t == "wind":
            self.weather["wind_speed"] = float(cmd.get("speed", self.weather["wind_speed"]))
            self.weather["wind_dir"]   = float(cmd.get("dir",   self.weather["wind_dir"]))
        elif t == "weather":
            for key in ("temp", "hum", "fmc", "rain"):
                if key in cmd:
                    self.weather[key] = float(cmd[key])
        elif t == "preset":
            name = cmd.get("name", "chergui")
            if name in PRESETS:
                self.weather = dict(PRESETS[name])
        elif t == "water":
            self._schedule_drop(float(cmd["lat"]), float(cmd["lon"]), float(cmd.get("radius", 150)))
        elif t == "device_add":
            self._add_device(cmd)
        elif t == "device_move":
            dev = self.devices.get(cmd.get("id"))
            if dev:
                dev.lat = float(cmd["lat"])
                dev.lon = float(cmd["lon"])
                dev.needs_inscription = True   # la nouvelle position part dans l'inscription
        elif t == "device_rotate":
            dev = self.devices.get(cmd.get("id"))
            if dev:
                dev.azimuth = float(cmd.get("azimuth", 0)) % 360.0
        elif t == "device_remove":
            self.devices.pop(cmd.get("id"), None)
        elif t == "device_fault":
            dev = self.devices.get(cmd.get("id"))
            if dev:
                dev.set_fault(cmd.get("mode", "ok"))
        elif t == "time_scale":
            self.time_scale = max(1, int(cmd.get("x", 15)))
        elif t == "reset":
            self.fire.reset()
            self.weather = default_weather()
            self.drops = []
            self._scheduled_commands.clear()
        elif t == "scenario":
            self._run_scenario(cmd.get("name", "chergui"))

    def _schedule_drop(self, lat, lon, radius):
        """Canadair : l'eau touche le sol DROP_DELAY_S secondes après l'ordre."""
        self._drop_counter += 1
        self.drops.append({
            "id": self._drop_counter,
            "lat": lat,
            "lon": lon,
            "radius": radius,
            "impact_at": time.time() + DROP_DELAY_S,
            "done": False,
        })

    def add_device(self, kind, lat, lon, azimuth=0.0, device_id=None, period=None):
        """Crée et enregistre un appareil ; retourne son id (None sans fabrique)."""
        if self.device_factory is None:
            return None
        did = device_id
        if did is None:
            self._device_id_counter += 1
            did = "D{:03d}".format(self._device_id_counter)
            while did in self.devices:
                self._device_id_counter += 1
                did = "D{:03d}".format(self._device_id_counter)
        dev = self.device_factory(kind, did, float(lat), float(lon),
                                  period or self.default_period, float(azimuth))
        self.devices[did] = dev
        return did

    def _add_device(self, cmd):
        return self.add_device(cmd.get("kind", "station"), cmd["lat"], cmd["lon"],
                               cmd.get("azimuth", 0) or 0)

    def _ignite_near(self, lat, lon):
        """Allume la cellule la plus proche de (lat, lon) qui soit combustible."""
        r0, c0 = latlon_to_cell(lat, lon)
        for d in range(15):
            for dr in range(-d, d + 1):
                for dc in range(-d, d + 1):
                    if abs(dr) != d and abs(dc) != d:
                        continue
                    if self.fire.ignite(r0 + dr, c0 + dc):
                        return True
        return False

    def _run_scenario(self, name):
        """Préréglages de scénario de démo (météo + feu + commandes programmées)."""
        self._scheduled_commands.clear()
        if name == "chergui":
            # Feu à l'est, vent fort d'est → détection rapide sous le vent
            self.apply_command({"type": "preset", "name": "chergui"})
            self._ignite_near(35.135, -5.175)
        elif name == "au-vent":
            # Feu à l'ouest des capteurs, vent d'est → fumée s'éloigne
            self.apply_command({"type": "preset", "name": "chergui"})
            self._ignite_near(35.135, -5.258)
        elif name == "nuit":
            # Feu de nuit, faible vent
            self.apply_command({"type": "preset", "name": "nuit"})
            self._ignite_near(35.135, -5.215)
        elif name == "deux-foyers":
            # Deux foyers simultanés (sautes de feu)
            self.apply_command({"type": "preset", "name": "chergui"})
            self._ignite_near(35.147, -5.195)
            self._ignite_near(35.120, -5.237)
        elif name == "changement-vent":
            # Feu à l'est, vent tourne de 90° après 600 s simulées
            self.apply_command({"type": "preset", "name": "chergui"})
            self._ignite_near(35.135, -5.175)
            self._scheduled_commands.append(
                (self.sim_time + 600, {"type": "wind", "speed": 5.0, "dir": 190.0})
            )
        elif name == "pluie":
            # Feu démarre sous le Chergui, pluie arrive après 400 s simulées
            self.apply_command({"type": "preset", "name": "chergui"})
            self._ignite_near(35.135, -5.215)
            self._scheduled_commands.append(
                (self.sim_time + 400, {"type": "preset", "name": "pluie"})
            )
        elif name == "pluie_seule":
            self.apply_command({"type": "preset", "name": "pluie"})
        elif name == "reset":
            self.apply_command({"type": "reset"})

    # ------------------------------------------------------------------
    # Exposition au feu pour les capteurs
    # ------------------------------------------------------------------
    def fire_exposure(self, lat, lon):
        """
        Retourne (heat, smoke) ∈ [0,1] pour un capteur à (lat, lon).
        heat  : chaleur (cellules en feu proches)
        smoke : exposition au panache (cellules en feu sous le vent)
        """
        wind_from  = math.radians(self.weather.get("wind_dir", 0.0))
        # Vecteur vers lequel souffle le vent
        wind_to_n = -math.cos(wind_from)
        wind_to_e = -math.sin(wind_from)

        burning = self.fire.burning_cells()
        if not burning:
            return 0.0, 0.0

        center_lat = 35.135

        heat_sum = 0.0
        smoke_sum = 0.0
        HEAT_RANGE = 500.0    # m : chaleur significative dans ce rayon
        SMOKE_RANGE = 3000.0  # m : panache peut aller loin

        for (r, c) in burning:
            clat, clon = cell_to_latlon(r, c)
            dlat_m = (lat - clat) * 111_320
            dlon_m = (lon - clon) * 111_320 * math.cos(math.radians(center_lat))
            dist = math.hypot(dlat_m, dlon_m)
            if dist < 1.0:
                dist = 1.0

            # Chaleur : décroissance exponentielle
            if dist < HEAT_RANGE:
                heat_sum += math.exp(-dist / 150.0)

            # Fumée : panache gaussien sous le vent
            if dist < SMOKE_RANGE:
                # Composante dans la direction du vent
                sensor_n = dlat_m / dist
                sensor_e = dlon_m / dist
                along = sensor_n * wind_to_n + sensor_e * wind_to_e
                if along > -50:   # capteur dans la demi-sphère sous le vent
                    cross_n = sensor_n - along * wind_to_n
                    cross_e = sensor_e - along * wind_to_e
                    cross = math.hypot(cross_n * dist, cross_e * dist)
                    sigma = 100.0 + 0.3 * max(0.0, along * dist)  # plume qui s'élargit
                    gauss = math.exp(-cross ** 2 / (2 * sigma ** 2))
                    decay = math.exp(-dist / 1800.0)
                    smoke_sum += gauss * decay

        heat  = min(1.0, heat_sum)
        smoke = min(1.0, smoke_sum)
        return heat, smoke

    # ------------------------------------------------------------------
    # Snapshot pour POST /api/sim/world
    # ------------------------------------------------------------------
    def snapshot(self):
        """
        Retourne un dict JSON-sérialisable représentant la vérité terrain.
        - grid.cells : 1 caractère par cellule (F, B, X, W, R)
        - burning    : [[r, c, intensité 0-100], ...] des cellules en feu
        - spots      : sautes de feu survenues depuis le dernier snapshot
        - drops      : largages Canadair en cours (impactIn = s avant impact)
        """
        now = time.time()
        return {
            "grid": {
                "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON},
                "cell": CELL_M,
                "rows": ROWS,
                "cols": COLS,
                "cells": self.fire.compact_grid(),
            },
            "fires": self.fire.fires_snapshot(),
            "burning": self.fire.burning_intensity(),
            "spots": self.fire.drain_spots(),
            "drops": [
                {"id": d["id"], "lat": d["lat"], "lon": d["lon"], "radius": d["radius"],
                 "impactIn": round(d["impact_at"] - now, 2)}
                for d in self.drops
            ],
            "weather": dict(self.weather),
            "devices": [d.to_dict() for d in self.devices.values()],
            "radio": {k: (round(v, 1) if isinstance(v, float) else v)
                      for k, v in self.radio_stats.items()},
            "timeScale": self.time_scale,
            "speed": self.speed,
            "simTime": round(self.sim_time, 1),
        }
