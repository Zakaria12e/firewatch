"""
Couche LoRaWAN simulée (EU868, classe A) : trames et charges utiles compactes.

Trame physique (PHYPayload, LoRaWAN 1.0.x, sans FOpts) :
    MHDR(1) | DevAddr(4, LE) | FCtrl(1) | FCnt(2, LE) | FPort(1) | FRMPayload | MIC(4)
soit 13 octets d'en-tête autour de la charge utile applicative.

Charges utiles (FRMPayload, CBOR), décrites par shared/lora-schema.json :
- FPort 1 « inscription » : [version, id, type, lat×1e5, lon×1e5, [codes canaux], [codes unités]]
  envoyée au premier contact, après un déplacement ou quand le serveur la redemande ;
- FPort 2 « mesures » : tableau positionnel d'entiers selon le type (pas de noms, ni d'unités,
  ni de position) : le serveur reconstruit le SenML complet à partir de l'inscription ;
- FPort 3 « SenML complet » : paquet SenML/CBOR d'origine (option --senml-full, comparaison).

La charge utile maximale dépend du SF (EU868) : 222 o (SF7-8), 115 o (SF9), 51 o (SF10-12).
"""
from __future__ import annotations

import json
import os
import struct
import zlib

_SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "..", "..", "shared", "lora-schema.json")

try:
    with open(_SCHEMA_PATH, encoding="utf-8") as _f:
        SCHEMA = json.load(_f)
except FileNotFoundError:
    raise SystemExit("Schéma LoRaWAN introuvable ({}) : copier aussi le dossier shared/ "
                     "à côté de simulator/.".format(os.path.normpath(_SCHEMA_PATH)))

VERSION = SCHEMA["version"]
FPORT_INSCRIPTION = SCHEMA["fport"]["inscription"]
FPORT_MESURES = SCHEMA["fport"]["mesures"]
FPORT_SENML = SCHEMA["fport"]["senml"]
OVERHEAD = SCHEMA["overheadBytes"]
DUTY_CYCLE = SCHEMA["dutyCycle"]
MAX_PAYLOAD = {int(k): v for k, v in SCHEMA["maxPayload"].items()}

MHDR_UNCONFIRMED_UP = 0x40
MHDR_CONFIRMED_UP = 0x80
FCTRL_ADR = 0x80


def devaddr_for(device_id):
    """DevAddr 32 bits attribué à l'appareil (préfixe réseau 0x26, adresse dérivée de l'ID)."""
    return 0x26000000 | (zlib.crc32(device_id.encode("utf-8")) & 0x01FFFFFF)


def max_payload(sf):
    return MAX_PAYLOAD.get(int(sf), 51)


def layout(kind):
    return SCHEMA["layouts"].get(kind)


# ---------------------------------------------------------------------------
# Charges utiles
# ---------------------------------------------------------------------------
def inscription_payload(device_id, kind, lat, lon):
    """Liste CBOR de l'inscription (FPort 1)."""
    lay = layout(kind) or {"fields": []}
    chans = SCHEMA["channels"]
    codes = [chans[name]["code"] for name in lay["fields"]]
    units = [SCHEMA["units"][chans[name]["u"]] for name in lay["fields"]]
    return [VERSION, device_id, SCHEMA["kinds"][kind],
            int(round(lat * 1e5)), int(round(lon * 1e5)), codes, units]


def measures_payload(kind, readings, battery, azimuth=0.0):
    """
    Tableau positionnel d'entiers (FPort 2) : valeur × échelle, arrondie.
    Aucune valeur n'est bornée : un capteur en panne (pic, dérive) doit rester visible
    côté serveur pour que la détection de santé le repère.
    """
    lay = layout(kind)
    if lay is None:
        raise ValueError("type sans format compact : {}".format(kind))
    chans = SCHEMA["channels"]
    out = []
    for name in lay["fields"]:
        if name == "flags":
            bits = 0
            for i, flag in enumerate(lay.get("bits", [])):
                if readings.get(flag):
                    bits |= 1 << i
            out.append(bits)
            continue
        if name == "bat":
            val = battery
        elif name == "azimuth":
            val = azimuth
        else:
            val = readings.get(name)
        if val is None:
            out.append(None)
        else:
            out.append(int(round(float(val) * chans[name]["scale"])))
    return out


# ---------------------------------------------------------------------------
# Trame physique
# ---------------------------------------------------------------------------
def build_phy(devaddr, fcnt, fport, frm_payload, confirmed=False):
    """PHYPayload LoRaWAN (MIC à zéro : pas de clés de session dans ce mode)."""
    mhdr = MHDR_CONFIRMED_UP if confirmed else MHDR_UNCONFIRMED_UP
    header = struct.pack("<BIBHB", mhdr, devaddr, FCTRL_ADR, fcnt & 0xFFFF, fport)
    return header + bytes(frm_payload) + b"\x00\x00\x00\x00"


def min_interval_s(airtime_ms, duty=DUTY_CYCLE):
    """Silence imposé après une émission pour respecter le duty cycle (s, temps simulé)."""
    return airtime_ms / 1000.0 * (1.0 / duty - 1.0)
