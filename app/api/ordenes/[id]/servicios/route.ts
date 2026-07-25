import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { calcularCostoFinalSincronizado } from "@/lib/servicios/sincronizar-costo-final"
import { ESTADOS_COSTO_FINAL_BLOQUEADO } from "@/lib/orden-state-machine"
import { z } from "zod"

const lineaSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("catalogo"),
    servicioId: z.string().min(1),
    cantidad: z.number().int().positive("La cantidad debe ser mayor a cero"),
    precioUnitario: z.number().min(0).optional(),
  }),
  z.object({
    tipo: z.literal("manual"),
    nombre: z.string().min(1, "El nombre es requerido").max(120),
    cantidad: z.number().int().positive("La cantidad debe ser mayor a cero"),
    precioUnitario: z.number().min(0, "El precio no puede ser negativo"),
    guardarEnCatalogo: z.boolean().default(false),
  }),
])

function lineaDTO(l: any) {
  return {
    id: l.id,
    servicioId: l.servicio_id,
    nombre: l.nombre,
    cantidad: l.cantidad,
    precioUnitario: Number(l.precio_unitario),
  }
}

function sumar(lineas: any[]): number {
  const total = (lineas || []).reduce(
    (acc, l) => acc + Number(l.cantidad) * Number(l.precio_unitario),
    0
  )
  return Math.round(total * 100) / 100
}

/**
 * Aplica la regla de sincronización y persiste costo_final si corresponde.
 * El recálculo de estado_cobro lo hace el trigger de la migración 277.
 */
async function sincronizarCostoFinal(orden: any, sumaAnterior: number, sumaNueva: number) {
  const decision = calcularCostoFinalSincronizado({
    costoFinalActual: orden.costo_final,
    totalCobrado: orden.total_cobrado,
    sumaAnterior,
    sumaNueva,
  })

  if (!decision.debeActualizar) return false

  // La orden ya cruzó el gate de costo_final de REPARADO (ver
  // ESTADOS_COSTO_FINAL_BLOQUEADO): no lo dejamos en null/0 en automático aunque
  // la regla de sincronización lo pida, porque ahí ya es la base de la comisión
  // del técnico y del saldo pendiente. Igual que cuando hay cobros o el costo
  // fue editado a mano, el desajuste queda visible vía costoFinalActualizado:false
  // en el banner de "Aplicar al total" (que ahora lo va a rechazar también).
  if (
    (decision.nuevoCostoFinal === null || decision.nuevoCostoFinal === 0) &&
    ESTADOS_COSTO_FINAL_BLOQUEADO.includes(orden.estado)
  ) {
    return false
  }

  const { error } = await supabaseAdmin
    .from("ordenes_servicio")
    .update({ costo_final: decision.nuevoCostoFinal })
    .eq("id", orden.id)

  if (error) {
    console.error("Error sincronizando costo_final:", error)
    return false
  }
  return true
}

async function cargarOrden(ordenId: string, organizationId: string) {
  const { data } = await supabaseAdmin
    .from("ordenes_servicio")
    .select("id, costo_final, total_cobrado, estado, organization_id")
    .eq("id", ordenId)
    .eq("organization_id", organizationId)
    .single()
  return data
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id: ordenId } = await params
    const parsed = lineaSchema.parse(await request.json())

    const orden = await cargarOrden(ordenId, organizationId!)
    if (!orden) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }

    // Snapshot de nombre y precio. Si viene del catálogo, se leen de ahí, pero
    // el precio enviado gana: el catálogo es un default, no una atadura.
    let nombre: string
    let precioUnitario: number
    let servicioId: string | null = null

    if (parsed.tipo === "catalogo") {
      const { data: servicio } = await supabaseAdmin
        .from("servicios")
        .select("id, nombre, precio")
        .eq("id", parsed.servicioId)
        .eq("organization_id", organizationId!)
        .is("deleted_at", null)
        .single()

      if (!servicio) {
        return NextResponse.json({ error: "Servicio no encontrado" }, { status: 404 })
      }

      servicioId = servicio.id
      nombre = servicio.nombre
      precioUnitario = parsed.precioUnitario ?? Number(servicio.precio)
    } else {
      nombre = parsed.nombre
      precioUnitario = parsed.precioUnitario
    }

    const { data: lineasPrevias } = await supabaseAdmin
      .from("servicios_orden")
      .select("cantidad, precio_unitario")
      .eq("orden_id", ordenId)

    const sumaAnterior = sumar(lineasPrevias || [])

    const { data: nueva, error: insertError } = await supabaseAdmin
      .from("servicios_orden")
      .insert({
        orden_id: ordenId,
        servicio_id: servicioId,
        nombre,
        cantidad: parsed.cantidad,
        precio_unitario: precioUnitario,
      })
      .select("*")
      .single()

    if (insertError || !nueva) {
      console.error("Error creating servicio_orden:", insertError)
      return NextResponse.json({ error: "Error al agregar el servicio" }, { status: 500 })
    }

    const sumaNueva = Math.round((sumaAnterior + parsed.cantidad * precioUnitario) * 100) / 100
    const costoFinalActualizado = await sincronizarCostoFinal(orden, sumaAnterior, sumaNueva)

    // Alta oportunista en el catálogo: permite construirlo trabajando, sin
    // configuración previa. Un fallo acá no invalida la línea ya creada.
    if (parsed.tipo === "manual" && parsed.guardarEnCatalogo) {
      const { error: catalogoError } = await supabaseAdmin.from("servicios").insert({
        organization_id: organizationId!,
        codigo: `SRV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        nombre,
        precio: precioUnitario,
      })
      if (catalogoError) console.error("Error guardando en catalogo:", catalogoError)
    }

    return NextResponse.json(
      { servicio: lineaDTO(nueva), costoFinalActualizado, sumaServicios: sumaNueva },
      { status: 201 }
    )
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error adding servicio a orden:", err)
    return NextResponse.json({ error: "Error al agregar el servicio" }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id: ordenId } = await params
    const servicioOrdenId = new URL(request.url).searchParams.get("servicioOrdenId")

    if (!servicioOrdenId) {
      return NextResponse.json({ error: "Falta servicioOrdenId" }, { status: 400 })
    }

    const orden = await cargarOrden(ordenId, organizationId!)
    if (!orden) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }

    const { data: lineasPrevias } = await supabaseAdmin
      .from("servicios_orden")
      .select("id, cantidad, precio_unitario")
      .eq("orden_id", ordenId)

    const sumaAnterior = sumar(lineasPrevias || [])
    const eliminada = (lineasPrevias || []).find((l: any) => l.id === servicioOrdenId)

    if (!eliminada) {
      return NextResponse.json({ error: "Servicio no encontrado en la orden" }, { status: 404 })
    }

    const { error: deleteError } = await supabaseAdmin
      .from("servicios_orden")
      .delete()
      .eq("id", servicioOrdenId)
      .eq("orden_id", ordenId)

    if (deleteError) {
      console.error("Error deleting servicio_orden:", deleteError)
      return NextResponse.json({ error: "Error al eliminar el servicio" }, { status: 500 })
    }

    const sumaNueva = Math.round(
      (sumaAnterior - Number(eliminada.cantidad) * Number(eliminada.precio_unitario)) * 100
    ) / 100
    const costoFinalActualizado = await sincronizarCostoFinal(orden, sumaAnterior, sumaNueva)

    return NextResponse.json({ costoFinalActualizado, sumaServicios: sumaNueva })
  } catch (err) {
    console.error("Error deleting servicio de orden:", err)
    return NextResponse.json({ error: "Error al eliminar el servicio" }, { status: 500 })
  }
}
