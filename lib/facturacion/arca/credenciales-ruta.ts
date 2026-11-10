/**
 * Credenciales ARCA de la organización para las rutas que hablan con ARCA fuera
 * de la emisión (anular una factura, verificar una nota de crédito).
 *
 * Mismo mapeo que `emitir/route.ts` (fila de `facturacion_credenciales` ->
 * `resolverCredenciales`, ambiente por `isArcaProduction`), con una diferencia a
 * propósito: una nota de crédito fiscal solo existe en ARCA, así que una fila de
 * TusFacturas se rechaza ANTES de resolver el ambiente ni descifrar nada.
 *
 * El resultado es un valor y no una excepción para que cada ruta lo devuelva tal
 * cual: los mensajes son seguros de mostrar y nunca incluyen secretos.
 */

import { supabaseAdmin } from "@/lib/supabase"
import { isArcaProduction } from "@/lib/facturacion/arca/env"
import { ArcaStappCertError } from "@/lib/facturacion/arca/stapp-cert"
import { CredencialesIncompletasError, resolverCredenciales } from "@/lib/facturacion/resolver-credenciales"
import type { ArcaCredenciales } from "@/lib/facturacion/types"

export type CredencialesArcaCargadas =
  | { ok: true; provider: "arca" | "arca_delegado"; creds: ArcaCredenciales }
  | { ok: false; status: 400 | 409 | 500; error: string }

const falla = (status: 400 | 409 | 500, error: string): CredencialesArcaCargadas => ({ ok: false, status, error })

export async function cargarCredencialesArca(organizationId: string): Promise<CredencialesArcaCargadas> {
  const { data: fila, error: dbError } = await supabaseAdmin
    .from("facturacion_credenciales")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle()
  if (dbError) return falla(500, "No se pudieron cargar las credenciales")
  if (!fila) return falla(400, "Credenciales no configuradas")

  // Una fila anterior a la migración 299 no tiene `provider` y es de TusFacturas.
  if (fila.provider !== "arca" && fila.provider !== "arca_delegado") {
    return falla(409, "La facturación de esta organización no es directa con ARCA: no se puede emitir una nota de crédito.")
  }

  let production: boolean
  try {
    production = isArcaProduction()
  } catch {
    return falla(500, "Ambiente ARCA no configurado")
  }

  try {
    const resuelto = resolverCredenciales({ row: fila, organizationId, production })
    // `resolverCredenciales` devuelve TusFacturas solo para una fila sin proveedor ARCA,
    // y ese caso ya se cortó arriba: se estrecha el tipo sin confiar en un cast.
    if (resuelto.provider === "tusfacturas") {
      return falla(409, "La facturación de esta organización no es directa con ARCA: no se puede emitir una nota de crédito.")
    }
    return { ok: true, provider: resuelto.provider, creds: resuelto.creds }
  } catch (e) {
    if (e instanceof CredencialesIncompletasError) return falla(400, e.message)
    if (e instanceof ArcaStappCertError) {
      // Configuración de la PLATAFORMA: si falta, todas las orgs delegadas dejan de
      // facturar a la vez. Se nombra para que el mensaje no mande a leer logs.
      console.error("[facturacion] certificado de plataforma mal configurado", e.message)
      return falla(500, "Certificado de plataforma no configurado — contactar soporte")
    }
    return falla(500, "No se pudieron leer las credenciales")
  }
}
