import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id: ordenId } = await params
    const parsed = lineaSchema.parse(await request.json())

    // Snapshot de nombre y precio. Si viene del catálogo, se leen de ahí, pero
    // el precio enviado gana: el catálogo es un default, no una atadura. Esta
    // resolución queda fuera del RPC porque no es parte de la condición de
    // carrera: solo lee el catálogo, no toca la orden.
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

    // Insert + suma + sincronización de costo_final en una única transacción,
    // con SELECT ... FOR UPDATE sobre la orden: ver migration 301. Antes esto
    // era un SELECT-then-decide-then-UPDATE en JS (cada llamada de supabase-js
    // es su propia transacción), lo que dejaba una condición de carrera entre
    // altas concurrentes sobre la misma orden.
    const { data: result, error: rpcError } = await supabaseAdmin.rpc(
      "agregar_servicio_orden",
      {
        p_orden_id: ordenId,
        p_organization_id: organizationId!,
        p_servicio_id: servicioId,
        p_nombre: nombre,
        p_cantidad: parsed.cantidad,
        p_precio_unitario: precioUnitario,
      }
    )

    if (rpcError) throw rpcError

    if (result?.error) {
      return NextResponse.json({ error: result.error }, { status: 404 })
    }

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

    // El DTO se arma con la fila que devuelve el RPC (persistida), no con las
    // variables locales del request: precio_unitario es DECIMAL(10,2) y
    // Postgres redondea al guardar, asi que el request y la fila pueden
    // divergir en los decimales (ver comentario en agregar_servicio_orden).
    return NextResponse.json(
      {
        servicio: lineaDTO(result),
        campoSincronizado: result.campoSincronizado ?? null,
        montoActualizado: result.montoActualizado ?? false,
        costoFinalActualizado: result.costoFinalActualizado,
        sumaServicios: result.sumaServicios,
      },
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

    // Delete + suma + sincronización de costo_final en una única transacción,
    // con SELECT ... FOR UPDATE sobre la orden: ver migration 301.
    const { data: result, error: rpcError } = await supabaseAdmin.rpc(
      "eliminar_servicio_orden",
      {
        p_orden_id: ordenId,
        p_organization_id: organizationId!,
        p_servicio_orden_id: servicioOrdenId,
      }
    )

    if (rpcError) throw rpcError

    if (result?.error) {
      return NextResponse.json({ error: result.error }, { status: 404 })
    }

    return NextResponse.json({
      campoSincronizado: result.campoSincronizado ?? null,
      montoActualizado: result.montoActualizado ?? false,
      costoFinalActualizado: result.costoFinalActualizado,
      sumaServicios: result.sumaServicios,
    })
  } catch (err) {
    console.error("Error deleting servicio de orden:", err)
    return NextResponse.json({ error: "Error al eliminar el servicio" }, { status: 500 })
  }
}

/**
 * "Aplicar al total": escribe la suma de las lineas en el monto vivo de la orden
 * (presupuesto antes de APROBADO, costo_final desde APROBADO).
 *
 * Va por un RPC dedicado y NO por el PUT de /api/ordenes/[id] a proposito: ese
 * PUT auto-transiciona la orden a PRESUPUESTADO al escribir presupuesto
 * (route.ts:345-348) y encola la notificacion al cliente (:505). Aplicar un
 * monto calculado no es presupuestar: cambiar de estado y avisarle al cliente
 * siguen siendo actos explicitos del operador.
 *
 * El RPC rechaza dejar costo_final por debajo de total_cobrado, que es la guarda
 * que evita que estado_cobro pase a COBRADO y la deuda desaparezca.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id: ordenId } = await params

    const { data: result, error: rpcError } = await supabaseAdmin.rpc(
      "aplicar_monto_servicios_orden",
      {
        p_orden_id: ordenId,
        p_organization_id: organizationId!,
      }
    )

    if (rpcError) throw rpcError

    if (result?.error) {
      const noEncontrada = result.error === "Orden no encontrada"
      return NextResponse.json({ error: result.error }, { status: noEncontrada ? 404 : 400 })
    }

    return NextResponse.json({
      campoSincronizado: result.campoSincronizado,
      monto: result.monto,
    })
  } catch (err) {
    console.error("Error aplicando el monto de servicios:", err)
    return NextResponse.json({ error: "Error al aplicar el total" }, { status: 500 })
  }
}
