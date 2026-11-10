# Architecture FireWatch

```mermaid
flowchart LR
    subgraph F["🌲 Forêt (nœuds de capteurs virtuels)"]
        S1["DHT22<br/>température + humidité"]
        S2["MQ-2<br/>fumée / gaz"]
        S3["MQ-7<br/>monoxyde de carbone"]
        S4["KY-026<br/>flamme infrarouge"]
        S5["Anémomètre<br/>vent"]
        S6["GPS NEO-6M<br/>position"]
        SIR["🚨 Sirène<br/>buzzer + relais"]
    end

    N["📟 Nœud IoT<br/>ESP32 + LoRa SX1276"]
    R["📡 Réseau<br/>CoAP + CBOR/SenML"]
    M["☁️ Open-Meteo"]
    SV["🖥️ Serveur Node.js<br/>confirme le feu<br/>prévoit la direction"]
    DB[("🗄️ MongoDB")]
    D["🗺️ Dashboard<br/>React + shadcn + Leaflet"]
    PH["📱 iPhone<br/>ntfy / Pushover"]

    S1 & S2 & S3 & S4 & S5 & S6 --> N
    N -->|mesures| R --> SV
    M --> SV
    SV <--> DB
    SV --> D
    SV ==>|alerte urgente| PH
    SV -.->|déclencher sirène| R -.-> N -.-> SIR
```

## Flux d'une mesure

1. Le nœud lit ses capteurs et construit un paquet **SenML**.
2. Le paquet est codé en **CBOR** et envoyé en **CoAP POST** (UDP 5683).
3. Le serveur décode, enregistre dans **MongoDB** et met à jour la carte via **Socket.io**.
4. La réponse CoAP transporte les ordres vers le nœud (fréquence d'envoi, sirène).
