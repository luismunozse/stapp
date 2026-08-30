/**
 * Traduce una fila de `facturacion_credenciales` a las credenciales tipadas
 * del proveedor que corresponda, descifrando los secretos recién acá.
 *
 * Existe como módulo aparte de la ruta de emisión porque es el único lugar
 * donde una fila mal formada puede convertirse en un `TypeError` opaco:
 * `decryptSecret(null)` explota sin decir cuál columna falta. Acá se
 * chequean primero y se falla con un error con nombre.
 */

import { decryptSecret } from "@/lib/facturacion/crypto"
import type {
  ArcaCredenciales,
  CondicionFiscalEmisor,
  FacturacionCredenciales,
} from "@/lib/facturacion/types"

export class CredencialesIncompletasError extends Error {
  constructor(provider: string, faltantes: string[]) {
    super(`Credenciales de ${provider} incompletas: falta ${faltantes.join(", ")}`)
    this.name = "CredencialesIncompletasError"
  }
}

export type CredencialesResueltas =
  | { provider: "arca"; creds: ArcaCredenciales }
  | { provider: "tusfacturas"; creds: FacturacionCredenciales }

interface CredencialesRow {
  provider?: string | null
  cuit?: string | null
  cert_pem_enc?: string | null
  key_pem_enc?: string | null
  apitoken_enc?: string | null
  apikey_enc?: string | null
  usertoken_enc?: string | null
  punto_venta?: number | null
  condicion_fiscal?: string | null
}

export interface ResolverCredencialesParams {
  row: CredencialesRow
  organizationId: string
  /** Ambiente ARCA resuelto por `isArcaProduction()`; irrelevante para TusFacturas. */
  production: boolean
}

function exigir(row: CredencialesRow, columnas: Array<keyof CredencialesRow>, provider: string): void {
  const faltantes = columnas.filter((c) => row[c] == null).map(String)
  if (faltantes.length > 0) {
    throw new CredencialesIncompletasError(provider, faltantes)
  }
}

export function resolverCredenciales(params: ResolverCredencialesParams): CredencialesResueltas {
  const { row, organizationId, production } = params
  const condicionFiscal = (row.condicion_fiscal ?? "MONOTRIBUTO") as CondicionFiscalEmisor
  const puntoVenta = row.punto_venta ?? 1

  if (row.provider === "arca") {
    exigir(row, ["cuit", "cert_pem_enc", "key_pem_enc"], "ARCA")

    return {
      provider: "arca",
      creds: {
        organizationId,
        cuit: row.cuit as string,
        certPem: decryptSecret(row.cert_pem_enc as string),
        keyPem: decryptSecret(row.key_pem_enc as string),
        puntoVenta,
        condicionFiscal,
        production,
      },
    }
  }

  // Antes de la migración 299 la columna `provider` no existía y toda fila
  // era implícitamente de TusFacturas.
  exigir(row, ["apitoken_enc", "apikey_enc", "usertoken_enc"], "TusFacturas")

  return {
    provider: "tusfacturas",
    creds: {
      apitoken: decryptSecret(row.apitoken_enc as string),
      apikey: decryptSecret(row.apikey_enc as string),
      usertoken: decryptSecret(row.usertoken_enc as string),
      puntoVenta,
      condicionFiscal,
    },
  }
}
