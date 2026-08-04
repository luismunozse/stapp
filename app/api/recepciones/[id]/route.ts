import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"
import { calcularTotalLote, type DescuentoTipo } from "@/lib/lote-utils"

const FEATURE_KEY = "recepcion_multiple"
const ESTADOS_ENTREGADOS = ["ENTREGADO", "ENTREGADO_SIN_REPARACION", "ENTREGADO_SIN_COBRO"]

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { error, organizationId } = await requireAuth()
    if (error) return error

    // Gate de plan. hasPlanFeature aplica los overrides por organizacion.
    const hasFeature = await hasPlanFeature(organizationId!, FEATURE_KEY)
    if (!hasFeature) {
      return NextResponse.json(
        {
          error: "La recepcion de varios equipos esta disponible en el plan Profesional",
          code: "FEATURE_REQUIRED",
          feature: FEATURE_KEY,
        },
        { status: 403 },
      )
    }

    const { data: recepcion, error: recepcionError } = await supabaseAdmin
      .from("recepciones")
      .select("id, numero, codigo, cliente_id, descuento_tipo, descuento_valor, observaciones, created_at, clientes(nombre)")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (recepcionError) {
      if (recepcionError.code === "PGRST116") {
        return NextResponse.json({ error: "Recepcion no encontrada" }, { status: 404 })
      }
      throw recepcionError
    }
    if (!recepcion) {
      return NextResponse.json({ error: "Recepcion no encontrada" }, { status: 404 })
    }

    const { data: ordenes, error: ordenesError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id, numero_orden, codigo_orden, dispositivo, marca, estado, presupuesto, costo_final")
      .eq("recepcion_id", id)
      .eq("organization_id", organizationId!)
      .order("numero_orden", { ascending: true })

    if (ordenesError) {
      throw ordenesError
    }

    const lista = ordenes ?? []
    const subtotal = lista.reduce((acc, o) => acc + Number(o.costo_final ?? o.presupuesto ?? 0), 0)
    const totalLote = calcularTotalLote(
      subtotal,
      (recepcion.descuento_tipo as DescuentoTipo | null) ?? null,
      recepcion.descuento_valor != null ? Number(recepcion.descuento_valor) : null,
    )
    const entregadas = lista.filter((o) => ESTADOS_ENTREGADOS.includes(o.estado)).length

    return NextResponse.json({
      recepcion: {
        id: recepcion.id,
        numero: recepcion.numero,
        codigo: recepcion.codigo,
        clienteId: recepcion.cliente_id,
        clienteNombre: (recepcion as { clientes?: { nombre?: string } }).clientes?.nombre ?? "",
        descuentoTipo: recepcion.descuento_tipo ?? null,
        descuentoValor: recepcion.descuento_valor != null ? Number(recepcion.descuento_valor) : null,
        observaciones: recepcion.observaciones ?? null,
        createdAt: recepcion.created_at,
      },
      ordenes: lista.map((o) => ({
        id: o.id,
        numeroOrden: o.numero_orden,
        codigoOrden: o.codigo_orden ?? null,
        dispositivo: o.dispositivo,
        marca: o.marca ?? null,
        estado: o.estado,
        presupuesto: o.presupuesto != null ? Number(o.presupuesto) : null,
        costoFinal: o.costo_final != null ? Number(o.costo_final) : null,
      })),
      totales: {
        subtotal,
        totalLote,
        entregadas,
        pendientes: lista.length - entregadas,
      },
    })
  } catch (error) {
    console.error("Error fetching recepcion:", error)
    return NextResponse.json({ error: "Error al obtener la recepcion" }, { status: 500 })
  }
}
