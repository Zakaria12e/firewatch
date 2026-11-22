"""
Réseau LoRaWAN simulé (EU868, 125 kHz) : bilan de liaison appareil → passerelles.

- Perte en log-distance sous couvert forestier + perte linéaire de végétation,
  atténuation par le relief si la ligne de vue est coupée (diffraction simplifiée).
- RSSI = Ptx + gains − perte ; SNR = RSSI − bruit thermique (plafonné, comme le SX1276).
- ADR : le plus petit facteur d'étalement (SF7…SF12) qui garde une marge de 5 dB.
- Réception probabiliste selon la marge de SNR au-dessus du seuil de démodulation.
- Macro-diversité : toutes les passerelles à portée peuvent recevoir l'uplink ;
  le paquet est livré si au moins une le reçoit (déduplication côté serveur réseau).

Calibrage (sans relief) : SNR ≈ +12 dB à 1 km, +8 dB à 2 km, −3 dB à 3 km,
−12 dB à 4 km, limite SF12 (−20 dB) vers 4,9 km → rayon utile 3-5 km.
"""
from __future__ import annotations

import math

TX_POWER_DBM = 14.0        # puissance max EU868
G_DEV_DBI = 2.0            # antenne de l'appareil
G_GW_DBI = 6.0             # antenne de la passerelle (colinéaire sur pylône)
D0_M = 100.0               # distance de référence
PL_D0_DB = 75.0            # perte à 100 m sous couvert forestier (868 MHz)
N_EXP = 3.5                # exposant de perte en forêt
FOLIAGE_DB_PER_M = 0.005   # perte linéaire de végétation
NOISE_FLOOR_DBM = -117.0   # −174 + 10·log10(125 kHz) + NF 6 dB
SNR_MAX_DB = 12.0          # saturation du SNR mesuré par le SX1276
H_DEV_M = 3.0              # hauteur d'antenne des capteurs
H_GW_M = 25.0              # hauteur d'antenne des passerelles
CANOPY_M = 12.0            # hauteur de canopée prise en compte pour la ligne de vue

# Seuil de démodulation (SNR minimal) par facteur d'étalement
SF_SNR_MIN = {7: -7.5, 8: -10.0, 9: -12.5, 10: -15.0, 11: -17.5, 12: -20.0}
ADR_MARGIN_DB = 5.0


def dist_m(lat1, lon1, lat2, lon2):
    dlat = (lat2 - lat1) * 111_320
    dlon = (lon2 - lon1) * 111_320 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dlat, dlon)


def path_loss_db(d):
    """Perte de propagation (dB) à la distance d (m)."""
    d = max(1.0, d)
    return PL_D0_DB + 10 * N_EXP * math.log10(max(d, D0_M) / D0_M) + FOLIAGE_DB_PER_M * d


def relief_penalty_db(elev_fn, lat1, lon1, lat2, lon2, samples=16):
    """
    Atténuation supplémentaire si le relief coupe la ligne de vue
    (diffraction en lame de couteau simplifiée : 6 dB au rasant + 0,25 dB/m).
    """
    if elev_fn is None:
        return 0.0
    try:
        e1 = elev_fn(lat1, lon1) + H_DEV_M
        e2 = elev_fn(lat2, lon2) + H_GW_M
        worst = 0.0
        for i in range(1, samples):
            t = i / samples
            los = e1 + (e2 - e1) * t
            ground = elev_fn(lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t) + CANOPY_M
            if ground - los > worst:
                worst = ground - los
    except Exception:
        return 0.0
    if worst <= 0:
        return 0.0
    return min(30.0, 6.0 + 0.25 * worst)


def adr_sf(snr):
    """ADR simplifié : plus petit SF qui garde la marge au-dessus du seuil."""
    for sf in (7, 8, 9, 10, 11, 12):
        if snr >= SF_SNR_MIN[sf] + ADR_MARGIN_DB:
            return sf
    return 12


def rx_probability(snr, sf):
    """Probabilité de réception selon la marge de SNR au-dessus du seuil du SF."""
    margin = snr - SF_SNR_MIN[sf]
    if margin >= 3.0:
        return 0.99
    if margin >= 0.0:
        return 0.75 + 0.08 * margin
    return max(0.0, 0.5 + 0.25 * margin)


def airtime_ms(payload_bytes, sf, bw=125000, cr=1, preamble=8):
    """Temps d'antenne LoRa (formule Semtech AN1200.13), en millisecondes."""
    t_sym = (2 ** sf) / bw * 1000.0
    de = 1 if sf >= 11 else 0
    num = 8 * payload_bytes - 4 * sf + 28 + 16
    n_payload = 8 + max(math.ceil(num / (4.0 * (sf - 2 * de))) * (cr + 4), 0)
    return (preamble + 4.25) * t_sym + n_payload * t_sym


def uplink(lat, lon, gateways, elev_fn, rng):
    """
    Simule un uplink depuis (lat, lon) vers les passerelles actives.
    Retourne {delivered, gw, rssi, snr, sf, receivers, rssi_by} ;
    gw = meilleure passerelle ayant reçu (None si paquet perdu).
    """
    if not gateways:
        return {"delivered": False, "gw": None, "rssi": None, "snr": None, "sf": 12,
                "receivers": [], "rssi_by": {}, "reason": "aucune passerelle"}

    links = []
    for gw in gateways:
        d = dist_m(lat, lon, gw.lat, gw.lon)
        loss = path_loss_db(d) + relief_penalty_db(elev_fn, lat, lon, gw.lat, gw.lon)
        rssi = TX_POWER_DBM + G_DEV_DBI + G_GW_DBI - loss + rng.gauss(0, 2.0)
        snr = min(SNR_MAX_DB, rssi - NOISE_FLOOR_DBM) + rng.gauss(0, 1.0)
        links.append((gw.id, round(rssi, 1), round(snr, 1)))

    best_snr = max(l[2] for l in links)
    sf = adr_sf(best_snr)
    receivers = []
    rssi_by = {}
    for gid, rssi, snr in links:
        if rng.random() < rx_probability(snr, sf):
            receivers.append((gid, rssi, snr))
            rssi_by[gid] = rssi

    if not receivers:
        best = max(links, key=lambda l: l[2])
        return {"delivered": False, "gw": None, "rssi": best[1], "snr": best[2], "sf": sf,
                "receivers": [], "rssi_by": {}, "reason": "signal trop faible"}

    best = max(receivers, key=lambda l: l[2])
    return {
        "delivered": True,
        "gw": best[0],
        "rssi": best[1],
        "snr": best[2],
        "sf": sf,
        "receivers": [r[0] for r in receivers],
        "rssi_by": rssi_by,
    }
