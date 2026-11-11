import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getOrderByPublicToken } from "@/lib/public-token"
import { DEFAULT_TIMEZONE } from "@/lib/timezone"
import { diaCalendario } from "@/lib/garantias/estado"
import { configGarantiasDeFila } from "@/lib/garantias/config"
import {
  COLUMNAS_RECLAMO_PUBLICO,
  armarGarantiaPublica,
  elegirReclamoPublico,
  numeroOrdenPublico,
  type FilaGarantiaPublica,
  type FilaReclamoPublico,
} from "@/lib/garantias/seguimiento-publico"

/**
 * Endpoint PÚBLICO (sin auth, solo el token de seguimiento): la garantía de la
 * orden y el estado de su reclamo, con texto para el cliente. Lista blanca:
 * la respuesta la arma lib/garantias/seguimiento-publico.ts y nunca lleva ids,
 * quién registró o decidió el reclamo, notas internas ni la resolución.
 * Todas las lecturas van acotadas por la organización de la orden.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const { orden, error } = await getOrderByPublicToken(token)
    if (error) return error

    const organizationId = orden.organization_id as string

    const { data: garantia } = await supabaseAdmin
      .from("garantias")
      .select("id, dias_validez, fecha_inicio, fecha_vencimiento, estado, notas")
      .eq("orden_id", orden.id)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!garantia) {
      return NextResponse.json({ garantia: null })
    }

    const [{ data: org }, { data: reclamos }] = await Promise.all([
      supabaseAdmin.from("organizations").select("*").eq("id", organizationId).maybeSingle(),
      supabaseAdmin
        .from("reclamos_garantia")
        .select(COLUMNAS_RECLAMO_PUBLICO)
        .eq("garantia_id", garantia.id)
        .eq("organization_id", organizationId),
    ])

    const reclamo = elegirReclamoPublico((reclamos ?? []) as unknown as FilaReclamoPublico[])

    let ordenReingreso: string | null = null
    if (reclamo?.orden_reingreso_id) {
      const { data: reingreso } = await supabaseAdmin
        .from("ordenes_servicio")
        .select("numero_orden, codigo_orden")
        .eq("id", reclamo.orden_reingreso_id)
        .eq("organization_id", organizationId)
        .maybeSingle()
      ordenReingreso = numeroOrdenPublico(reingreso as { numero_orden: number | null; codigo_orden: string | null } | null)
    }

    const fila = org as Record<string, unknown> | null
    const zonaHoraria = (fila?.zona_horaria as string | null) || DEFAULT_TIMEZONE
    const config = configGarantiasDeFila(fila)
    const ahora = new Date()

    return NextResponse.json({
      garantia: armarGarantiaPublica(garantia as FilaGarantiaPublica, {
        hoy: diaCalendario(ahora, zonaHoraria),
        diaVencimiento: diaCalendario(garantia.fecha_vencimiento, zonaHoraria),
        ventana: config.ventanaPorVencer,
        terminos: config.terminos,
        reclamo,
        ordenReingreso,
      }),
    })
  } catch (error) {
    console.error("Error fetching warranty:", error)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
