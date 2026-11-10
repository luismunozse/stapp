import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"

/**
 * Verificación de la delegación ARCA de una organización (migración 385).
 *
 * ARCA autoriza a STApp a facturar por todos los CUIT que le delegaron, así
 * que el CUIT que declara una org no se usa hasta que un superadmin confirma
 * que es de esa org (razón social del CUIT vs. la organización). La ruta de
 * credenciales deja toda delegación nueva en 'pendiente_verificacion'.
 */

interface FilaDelegacion {
  provider: string | null
  cuit: string | null
  estado: string | null
  punto_venta: number | null
  condicion_fiscal: string | null
  updated_at: string | null
}

const COLUMNAS = "provider, cuit, estado, punto_venta, condicion_fiscal, updated_at"

function aRespuesta(fila: FilaDelegacion | null) {
  if (!fila || fila.provider !== "arca_delegado") return null
  return {
    cuit: fila.cuit,
    estado: fila.estado,
    puntoVenta: fila.punto_venta,
    condicionFiscal: fila.condicion_fiscal,
    updatedAt: fila.updated_at,
  }
}

async function leerDelegacion(organizationId: string) {
  return supabaseAdmin
    .from("facturacion_credenciales")
    .select(COLUMNAS)
    .eq("organization_id", organizationId)
    .maybeSingle()
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { error: authError } = await requireSuperadmin()
    if (authError) return authError

    const { id } = await params
    const { data, error } = await leerDelegacion(id)
    if (error) throw error

    return NextResponse.json({ delegacion: aRespuesta(data as FilaDelegacion | null) })
  } catch (err) {
    console.error("[superadmin] Error leyendo delegación ARCA:", err)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

const accionSchema = z.object({ accion: z.enum(["aprobar", "rechazar"]) })

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const { id } = await params
    const parsed = accionSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "Acción inválida (aprobar | rechazar)" }, { status: 400 })
    }
    const { accion } = parsed.data

    const { data: actual, error: readError } = await leerDelegacion(id)
    if (readError) throw readError
    const fila = actual as FilaDelegacion | null
    if (!fila || fila.provider !== "arca_delegado" || !fila.cuit) {
      return NextResponse.json({ error: "La organización no factura por delegación" }, { status: 404 })
    }

    const nuevoEstado = accion === "aprobar" ? "conectado" : "error"

    // El update se ata al CUIT que se revisó: si el taller lo cambió mientras
    // tanto, no se aprueba un CUIT que nadie miró.
    const { data: actualizada, error: updateError } = await supabaseAdmin
      .from("facturacion_credenciales")
      .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
      .eq("organization_id", id)
      .eq("provider", "arca_delegado")
      .eq("cuit", fila.cuit)
      .select(COLUMNAS)
      .maybeSingle()
    if (updateError) throw updateError
    if (!actualizada) {
      return NextResponse.json(
        { error: "La delegación cambió mientras se revisaba. Recargá y volvé a revisarla." },
        { status: 409 }
      )
    }

    createSuperadminAuditLogger(email ?? null, request)
      .log({
        action: "UPDATE",
        entity: "organizations",
        entityId: id,
        organizationId: id,
        description: `Delegación ARCA ${accion === "aprobar" ? "aprobada" : "rechazada"} (CUIT ${fila.cuit})`,
        metadata: { event: "ARCA_DELEGACION_VERIFICADA", accion, cuit: fila.cuit, estadoAnterior: fila.estado },
      })
      .catch(() => {})

    return NextResponse.json({ delegacion: aRespuesta(actualizada as FilaDelegacion) })
  } catch (err) {
    console.error("[superadmin] Error verificando delegación ARCA:", err)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
