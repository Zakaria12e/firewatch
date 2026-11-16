# Architecture FireWatch

## Vue d'ensemble

```
Dashboard (React + MapLibre 3D)
        │  Socket.io  │  HTTP REST
        ▼             ▼
   ┌─────────────────────────────────┐
   │      Serveur (Node.js)          │
   │  Express · Socket.io · CoAP     │
   │                                 │
   │  ┌─────────────────────────┐    │
   │  │  Pipeline de détection  │    │
   │  │  (server/src/detection/)│    │
   │  │  1. Santé des appareils │    │
   │  │  2. Baseline EWMA       │    │
   │  │  3. Indicateurs         │    │
   │  │  4. Fausses alertes     │    │
   │  │  5. Fusion multi-capteur│    │
   │  │  6. Localisation        │    │
   │  │  7. Prédiction          │    │
   │  └────────────┬────────────┘    │
   │               │ Incident        │
   │  ┌────────────▼────────────┐    │
   │  │  Alertes : ntfy/Pushover│    │
   │  │  Sirènes CoAP           │    │
   │  └─────────────────────────┘    │
   │                                 │
   │  MongoDB (optionnel)            │
   └────────────────┬────────────────┘
                    │ CoAP POST /fw/up (UDP 5683)
                    │ CBOR/SenML
       ┌────────────▼────────────┐
       │  Simulateur (Python)    │
       │  engine/world.py        │
       │  engine/fire.py  (CA)   │
       │  engine/forest.py       │
       │  engine/weather.py      │
       │  devices/station.py     │
       │  coap_client.py         │
       └─────────────────────────┘
```

## Protocoles IoT mis en avant

### CoAP (RFC 7252)
- Transport : **UDP**, port 5683
- Messages **CON** (confirmables) avec retransmissions exponentielles
- Méthode **POST** vers `/fw/up`
- Content-Format **60** = `application/cbor`
- Réponse **2.04 Changed** = ordres pour le nœud `{period, siren}` encodés en CBOR

Le client CoAP est écrit de zéro dans `simulator/coap_client.py` pour illustrer le protocole.

### CBOR (RFC 8949)
- Encodage compact des paquets SenML
- **−36 % en moyenne** par rapport à JSON sur les paquets de mesures
- Décodage côté serveur : `cbor-x`

### SenML (RFC 8428) avec labels entiers
```
[
  {-2: "urn:dev:fw:N01:", -3: 1716300000.0},   # bn, bt
  { 0: "temp",  1: "Cel",  2: 36.4 },          # n, u, v
  { 0: "hum",   1: "%RH",  2: 18.0 },
  { 0: "smoke", 1: "ppm",  2:  5.3 },
  { 0: "co",    1: "ppm",  2:  1.1 },
  { 0: "flame", 4: false },                     # vb
  { 0: "bat",   1: "%EL",  2: 87.2 },
  { 0: "rssi",  1: "dBW",  2: -80.0 },
  { 0: "lat",   2: 35.1414 },
  { 0: "lon",   2: -5.2082 }
]
```
Labels entiers (`n=0, u=1, v=2, vs=3, vb=4, bn=-2, bt=-3`) : économie supplémentaire ~8 %.

### LoRaWAN (simulé)
- RSSI calculé par perte en log-distance + atténuation relief (ligne de vue)
- SNR → facteur d'étalement SF7-SF12 (ADR simulé)
- Airtime selon SF et taille du paquet ; duty cycle 1 % (EU868)
- Perte de paquets probabiliste selon le SNR
- Coût énergétique par émission → autonomie estimée (jours)

## Automate cellulaire de propagation du feu

Grille 120 × 96 cellules de 50 m (6 km × 4,8 km), centrée sur Talassemtane.

**Probabilité de propagation** (8-voisins, par seconde simulée) :
```
p = BASE · dt · densité · sécheresse · exp(k_v · v · cos θ) · exp(k_p · pente)
```
- `θ` : angle entre voisin et direction du vent
- `sécheresse` : fonction de l'humidité et du FMC (Fine Fuel Moisture Content)
- `k_v = 0.18` (vent), `k_p = 0.07` (pente)

**Sautes de feu** (spotting) : vent > 8 m/s → émission de tisons à 100-400 m sous le vent.

**Relief** : Open-Meteo Elevation API → fichier cache `simulator/cache/elevation.json`.

## Pipeline de détection (server/src/detection/)

Chaque module est **pur** (aucun accès réseau, aucune base) et testé avec Vitest.

| Étape | Module | Rôle |
|---|---|---|
| 1 | `health.js` | Hors ligne, figé, aberrant, dérive, batterie faible |
| 2 | `baseline.js` | EWMA par canal, z-score, vitesse de montée |
| 3 | `indicators.js` | Flamme IR, point chaud thermique, fumée, CO, montée T, chute HR |
| 4 | `classifier.js` | Véhicule, brouillard, soleil, brûlage autorisé, barbecue |
| 5 | `fusion.js` | Score 0-100 : poids × corroboration × cohérence vent × prior météo |
| 6 | `localize.js` | Inversion panache (moindres carrés) + triangulation thermique |
| 7 | `predict.js` | Vitesse front, zones 15/30/60 min, villages menacés avec ETA |

**Niveaux d'alerte** : veille → vigilance → suspicion → pré-alerte → feu confirmé → maîtrisé

## Métriques (server/src/metrics.js)

- **Temps de détection** : `fire.startEpochMs` (simulateur) → `incident.startedAt` (serveur)
- **Économie CBOR** : taille CBOR réelle vs `JSON.stringify(pack)` par paquet reçu
- **PDR** : compteur côté serveur (paquets reçus / attendus calculé hors simulateur)
- **Fausses alertes évitées** : incrémenté quand `classifier.js` retourne un `kind`

## Flux d'une mesure de bout en bout

```
Station ESP32 (simulée)
  → lit capteurs (temp, hum, smoke, co, bat, rssi…)
  → construit SenML avec labels entiers
  → encode en CBOR (~237 octets)
  → CoAP CON POST coap://server:5683/fw/up

Serveur Node.js
  → décode CBOR → SenML
  → enregistre métriques CBOR vs JSON
  → extrait mesures → nodeStatus() + riskIndex()
  → appelle evaluate() (pipeline détection)
  → émet Socket.io "node" + "alert_level"
  → répond CoAP 2.04 : {period, siren} en CBOR

Dashboard React
  → socket.on("node") → met à jour la carte MapLibre
  → socket.on("alert_level") → met à jour la TopBar + IncidentPanel
  → si feu confirmé : flyTo() sur le foyer, sirène Web Audio
```
