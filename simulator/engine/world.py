"""
Monde simulé : état global, file d'ordres, tick(dt).
Fait le lien entre la forêt, le feu, la météo et les appareils.
"""
from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from .forest import Forest, latlon_to_cell, cell_to_latlon, ROWS, COLS, CELL_M
from .fire import FireModel
from .weather import PRESETS, default_weather


class World:
    def __init__(self, speed=1.0, real_weather=False):
        """
        speed        : facteur de vitesse de simulation (1 = temps réel, >1 = accéléré).
        real_weather : si True, tentera Open-Meteo au démarrage.
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
        self.devices = {}       # id → {id, kind, lat, lon, azimuth, fault}
        self.time_scale = 15    # 1 min réelle = time_scale min simulées (pour affichage)
        self.sim_time = 0.0     # secondes simulées depuis le début
        self._command_queue = []
        self._last_tick = time.time()
        self._device_id_counter = 0

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
            for key in ("temp", "hum", "fmc"):
                if key in cmd:
                    self.weather[key] = float(cmd[key])
        elif t == "preset":
            name = cmd.get("name", "chergui")
            if name in PRESETS:
                self.weather = dict(PRESETS[name])
        elif t == "water":
            r, c = latlon_to_cell(cmd["lat"], cmd["lon"])
            self.fire.extinguish(r, c, float(cmd.get("radius", 150)))
        elif t == "device_add":
            self._add_device(cmd)
        elif t == "device_move":
            dev = self.devices.get(cmd["id"])
            if dev:
                dev["lat"] = float(cmd["lat"])
                dev["lon"] = float(cmd["lon"])
        elif t == "device_rotate":
            dev = self.devices.get(cmd["id"])
            if dev:
                dev["azimuth"] = float(cmd.get("azimuth", 0))
        elif t == "device_remove":
            self.devices.pop(cmd.get("id"), None)
        elif t == "device_fault":
            dev = self.devices.get(cmd.get("id"))
            if dev:
                dev["fault"] = cmd.get("mode", "ok")
        elif t == "time_scale":
            self.time_scale = max(1, int(cmd.get("x", 15)))
        elif t == "reset":
            self.fire.reset()
            self.weather = default_weather()
        elif t == "scenario":
            self._run_scenario(cmd.get("name", "chergui"))

    def _add_device(self, cmd):
        did = "D{:04d}".format(self._device_id_counter)
        self._device_id_counter += 1
        self.devices[did] = {
            "id": did,
            "kind": cmd.get("kind", "station"),
            "lat": float(cmd["lat"]),
            "lon": float(cmd["lon"]),
            "azimuth": float(cmd.get("azimuth", 0)),
            "fault": "ok",
        }
        return did

    def _run_scenario(self, name):
        """Préréglages de scénario de démo."""
        if name == "chergui":
            self.apply_command({"type": "preset", "name": "chergui"})
        elif name == "pluie":
            self.apply_command({"type": "preset", "name": "pluie"})
        elif name == "nuit":
            self.apply_command({"type": "preset", "name": "nuit"})
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
        import math
        from .forest import latlon_to_cell, cell_to_latlon, CELL_M

        wind_speed = self.weather.get("wind_speed", 0.0)
        wind_from  = math.radians(self.weather.get("wind_dir", 0.0))
        # Vecteur vers lequel souffle le vent
        wind_to_n = -math.cos(wind_from)
        wind_to_e = -math.sin(wind_from)

        burning = self.fire.burning_cells()
        if not burning:
            return 0.0, 0.0

        center_lat = 35.135
        center_lon = -5.215

        def cell_dist_m(r, c):
            clat, clon = cell_to_latlon(r, c)
            dlat = (lat - clat) * 111_320
            dlon = (lon - clon) * 111_320 * math.cos(math.radians(center_lat))
            return math.hypot(dlat, dlon), dlat, dlon

        heat_sum = 0.0
        smoke_sum = 0.0
        HEAT_RANGE = 500.0    # m : chaleur significative dans ce rayon
        SMOKE_RANGE = 3000.0  # m : panache peut aller loin

        for (r, c) in burning:
            dist, dlat_m, dlon_m = cell_dist_m(r, c)
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
    def snapshot(self, devices_list):
        """
        Retourne un dict JSON-sérialisable représentant la vérité terrain.
        devices_list = liste des devices IoT actuels (stations + ajouts dynamiques).
        """
        return {
            "grid": {
                "origin": {
                    "lat": self.forest.rows,   # nombre de lignes (le client peut recalculer)
                    "lon": self.forest.cols,
                },
                "cell": CELL_M,
                "rows": ROWS,
                "cols": COLS,
                "cells": self.fire.compact_grid(),
            },
            "fires": self.fire.fires_snapshot(),
            "weather": dict(self.weather),
            "devices": [dict(d) for d in devices_list],
            "timeScale": self.time_scale,
            "simTime": round(self.sim_time, 1),
        }
