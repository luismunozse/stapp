/**
 * Resolución del ambiente ARCA (homologación vs. producción) — design ADR-09.
 *
 * `production` se resuelve EXCLUSIVAMENTE desde env, en este único lugar.
 * Fail-closed en AMBOS sentidos: un `NODE_ENV=production` sin `ARCA_ENV`
 * configurada nunca cae en "homologación" por default (emitiría comprobantes
 * no fiscales silenciosamente) — se rehúsa a operar. Fuera de producción,
 * el default es homologación (no exigimos la variable en dev/test).
 */

export class ArcaConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ArcaConfigError"
  }
}

export function isArcaProduction(): boolean {
  const v = process.env.ARCA_ENV
  if (v === "produccion") return true
  if (v === "homologacion") return false
  if (process.env.NODE_ENV === "production") {
    throw new ArcaConfigError("ARCA_ENV no configurada")
  }
  return false
}
