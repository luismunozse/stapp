import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"
import { calcularTotalLote, round2, type DescuentoTipo } from "@/lib/lote-utils"
import { ESTADOS_ENTREGADOS, esEstadoEntregado, esEstadoCerradoSinEntrega } from "@/lib/lote-estados"

const FEATURE_KEY = "recepcion_multiple"

// Mirrors the DB CHECK constraint (migration 293_recepcion_descuento.sql), which is
// NULL-safe and rejects half-specified pairs.
const descuentoSchema = z
  .object({
    descuentoTipo: z.enum(["porcentaje", "monto"]).nullable(),
    descuentoValor: z.number().positive("El valor del descuento debe ser mayor a 0").nullable(),
  })
  .refine(
    (d) =>
      (d.descuentoTipo === null && d.descuentoValor === null) ||
      (d.descuentoTipo !== null &&
        d.descuentoValor !== null &&
        (d.descuentoTipo !== "porcentaje" || d.descuentoValor <= 100)),
    { message: "Descuento invalido" },
  )

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
      .select("id, numero_orden, codigo_orden, dispositivo, marca, estado, presupuesto, costo_final, descuento_cobro")
      .eq("recepcion_id", id)
      .eq("organization_id", organizationId!)
      .order("numero_orden", { ascending: true })

    if (ordenesError) {
      throw ordenesError
    }

    const lista = ordenes ?? []
    // Base de las lineas de dinero: los miembros que siguen dentro del lote.
    // Las entregadas se quedan (su costo forma parte del total negociado); las
    // cerradas sin entrega salen — un cancelado con presupuesto no puede
    // inflar el total del lote. La lista de equipos igual las devuelve todas.
    const enElLote = lista.filter((o) => !esEstadoCerradoSinEntrega(o.estado))
    const subtotal = enElLote.reduce((acc, o) => acc + Number(o.costo_final ?? o.presupuesto ?? 0), 0)
    const totalLote = calcularTotalLote(
      subtotal,
      (recepcion.descuento_tipo as DescuentoTipo | null) ?? null,
      recepcion.descuento_valor != null ? Number(recepcion.descuento_valor) : null,
    )
    // Ya cobrado = neto facturado en los equipos que ya salieron (por el flujo
    // individual o por una entrega de lote previa). Pendiente de cobro = lo que
    // falta para llegar al total negociado del lote, nunca negativo.
    const entregados = enElLote.filter((o) => esEstadoEntregado(o.estado))
    const entregadas = entregados.length
    const yaCobrado = round2(
      entregados.reduce((acc, o) => acc + round2(Number(o.costo_final ?? 0) - Number(o.descuento_cobro ?? 0)), 0),
    )
    const pendienteCobro = Math.max(0, round2(totalLote - yaCobrado))

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
        yaCobrado,
        pendienteCobro,
        entregadas,
        // Elegibles todavia por entregar (los cerrados sin entrega no cuentan).
        pendientes: enElLote.length - entregadas,
      },
    })
  } catch (error) {
    console.error("Error fetching recepcion:", error)
    return NextResponse.json({ error: "Error al obtener la recepcion" }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { error, organizationId, role } = await requireAuth()
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

    // Editar el descuento es editar precios: solo un administrador puede hacerlo.
    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo un administrador puede modificar el descuento" },
        { status: 403 },
      )
    }

    const parsed = descuentoSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Datos invalidos" },
        { status: 400 },
      )
    }

    const { data: entregadas, error: entregadasError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id")
      .eq("recepcion_id", id)
      .eq("organization_id", organizationId!)
      .in("estado", [...ESTADOS_ENTREGADOS])
      .limit(1)

    if (entregadasError) {
      throw entregadasError
    }
    if (entregadas && entregadas.length > 0) {
      return NextResponse.json(
        { error: "No se puede modificar el descuento: el lote ya tiene equipos entregados" },
        { status: 409 },
      )
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("recepciones")
      .update({
        descuento_tipo: parsed.data.descuentoTipo,
        descuento_valor: parsed.data.descuentoValor,
      })
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .select("id")

    if (updateError) {
      throw updateError
    }
    if (!updated?.length) {
      return NextResponse.json({ error: "Recepcion no encontrada" }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error updating recepcion discount:", error)
    return NextResponse.json({ error: "Error al modificar el descuento" }, { status: 500 })
  }
}
