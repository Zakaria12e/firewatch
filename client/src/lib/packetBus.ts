/**
 * Bus d'événements « paquet CoAP reçu », hors de React : la carte 3D s'y abonne
 * pour les LED et les impulsions radio sans provoquer de re-rendu par paquet.
 */
export interface PacketEvent {
  id: string             // appareil émetteur
  gw: string | null      // passerelle qui a relayé le paquet
  rssi?: number          // dBm
  snr?: number           // dB
  bytes: number          // taille CBOR
  at: number             // horodatage de réception (ms)
}

type Listener = (e: PacketEvent) => void
const listeners = new Set<Listener>()

export const packetBus = {
  emit(e: PacketEvent) {
    listeners.forEach((l) => l(e))
  },
  on(l: Listener): () => void {
    listeners.add(l)
    return () => { listeners.delete(l) }
  },
}
