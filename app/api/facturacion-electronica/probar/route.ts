import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { arcaDirectProvider } from "@/lib/facturacion/arca/arca-direct-provider"
import { isArcaProduction } from "@/lib/facturacion/arca/env"
import { ArcaStappCertError } from "@/lib/facturacion/arca/stapp-cert"
import {
  resolverCredenciales,
  CredencialesIncompletasError,
  type CredencialesResueltas,
} from "@/lib/facturacion/resolver-credenciales"

/**
 * Diagnóstico de la conexión con ARCA.
 *
 * En el modelo BYO el error de configuración se detecta al subir el
 * certificado: el PUT de credenciales valida el par contra el CUIT declarado.
 * En DELEGACIÓN no hay nada que validar localmente — el trámite vive del lado
 * de AFIP (Administrador de Relaciones). Preguntarle a AFIP es la única
 * verificación posible, y sin ella el taller se entera de que la delegación
 * no quedó hecha recién cuando le falla una factura con un cliente esperando.
 *
 * Devuelve 200 aunque el diagnóstico sea negativo: la request funcionó, lo que
 * falló es la delegación. Los 4xx/5xx quedan para fallas del endpoint.
 */
export async function POST() {
  const { error, organizationId } = await requireAdmin()
  if (error) return error

  const { data: cred, error: credErr } = await supabaseAdmin
    .from("facturacion_credenciales")
    .select("*")
    .eq("organization_id", organizationId!)
    .maybeSingle()

  if (credErr) {
    return NextResponse.json({ error: "No se pudieron cargar las credenciales" }, { status: 500 })
  }
  if (!cred) {
    return NextResponse.json({ error: "Credenciales no configuradas" }, { status: 400 })
  }

  let production = false
  if (cred.provider === "arca" || cred.provider === "arca_delegado") {
    try {
      production = isArcaProduction()
    } catch {
      return NextResponse.json({ error: "Ambiente ARCA no configurado" }, { status: 500 })
    }
  }

  let resuelto: CredencialesResueltas
  try {
    resuelto = resolverCredenciales({ row: cred, organizationId: organizationId!, production })
  } catch (e) {
    if (e instanceof CredencialesIncompletasError) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
    if (e instanceof ArcaStappCertError) {
      console.error("[facturacion] certificado de plataforma mal configurado", e.message)
      return NextResponse.json(
        { error: "Certificado de plataforma no configurado — contactar soporte" },
        { status: 500 }
      )
    }
    return NextResponse.json({ error: "No se pudieron leer las credenciales" }, { status: 500 })
  }

  if (resuelto.provider === "tusfacturas") {
    return NextResponse.json(
      { error: "El diagnóstico solo aplica a la facturación directa con ARCA" },
      { status: 400 }
    )
  }

  const resultado = await arcaDirectProvider.probarConexion(resuelto.creds)

  return NextResponse.json({
    ok: resultado.ok,
    puntosVenta: resultado.puntosVenta ?? [],
    error: resultado.error,
    // Para que la UI pueda decir "en nombre de <cuit>" sin volver a pedirlo.
    cuitRepresentado: resuelto.creds.cuitRepresentado ?? resuelto.creds.cuit,
  })
}
