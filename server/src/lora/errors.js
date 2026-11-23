/** Erreur de réception LoRaWAN : `code` classe la cause, `rejoin` demande une réinscription. */
export class LoraError extends Error {
  constructor(code, message, { rejoin = false } = {}) {
    super(message)
    this.name = "LoraError"
    this.code = code
    this.rejoin = rejoin
  }
}
