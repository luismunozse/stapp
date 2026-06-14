import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { emitWebhookEvent } from "@/lib/webhooks/dispatcher"
import { z } from "zod"

// Endpoint dedicado de ajuste rápido de stock.
// No requiere reenviar el item completo (a diferencia de PUT /api/inventario/[id]).
// Delegado a la RPC adjust_stock_atomic, que aplica SELECT ... FOR UPDATE
// y registra el movimiento en una sola transacción para evitar race conditions
// entre ajustes concurrentes.
const adjustSchema = z.object({
  // Modo "absoluto": setea el stock al valor indicado.
  // Modo "delta": suma/resta al stock actual.
  mode: z.enum(["absolute", "delta"]),
  // Bound defensivo: evita overflow del INTEGER de Postgres y entradas absurdas.
  value: z.number().int().min(-1_000_000).max(1_000_000),
  motivo: z.string().max(500).optional(),
  // Tipo de movimiento a registrar. Default AJUSTE; para consolidación de
  // duplicados al crear un item nuevo pasamos "ENTRADA" y referenciaTipo "CONSOLIDACION".
  tipo: z.enum(["AJUSTE", "ENTRADA"]).optional(),
  referenciaTipo: z.string().max(50).optional(),
  depositoId: z.string().min(1).nullable().optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const { mode, value, motivo, tipo, referenciaTipo, depositoId } = adjustSchema.parse(body)

    const { data, error: rpcErr } = await supabaseAdmin.rpc("adjust_stock_atomic", {
      p_inventario_id: id,
      p_organization_id: organizationId!,
      p_user_id: userId!,
      p_mode: mode,
      p_value: value,
      p_motivo: motivo ?? null,
      p_tipo: tipo ?? "AJUSTE",
      p_referencia_tipo: referenciaTipo ?? "AJUSTE_MANUAL",
      p_deposito_id: depositoId ?? null,
    })

    if (rpcErr) {
      // Mapear errores de la RPC a respuestas HTTP coherentes.
      if (rpcErr.code === "P0002") {
        return NextResponse.json({ error: "Item no encontrado" }, { status: 404 })
      }
      if (rpcErr.code === "P0003") {
        return NextResponse.json(
          { error: "El stock no puede quedar negativo" },
          { status: 400 }
        )
      }
      if (rpcErr.code === "22023") {
        return NextResponse.json({ error: rpcErr.message }, { status: 400 })
      }
      if (rpcErr.code === "P0010") {
        return NextResponse.json(
          { error: "Stock insuficiente en el depósito seleccionado" },
          { status: 400 }
        )
      }
      if (rpcErr.code === "P0011") {
        return NextResponse.json(
          { error: "La organización no tiene depósito principal configurado" },
          { status: 400 }
        )
      }
      throw rpcErr
    }

    const result = data as {
      stock: number
      changed: boolean
      stockAnterior: number
      stockPosterior: number
      movimientoId: string | null
    }

    // Webhook outbound: inventario.stock_bajo
    // Limitación documentada: solo se dispara desde acá (endpoint API).
    // Ajustes hechos por SQL directo o triggers internos NO emiten — para eso
    // habría que migrar al trigger 168 con pg_notify, decisión postergada
    // por simplicidad (sin LISTEN dedicado en runtime).
    if (result.changed) {
      const { data: item } = await supabaseAdmin
        .from("inventario")
        .select("id, codigo, nombre, stock, punto_reorden, stock_minimo, organization_id")
        .eq("id", id)
        .single()
      if (item && item.organization_id === organizationId) {
        // Disparar solo en cruce hacia abajo. Si ya estaba por debajo y
        // bajó más, igual disparamos (consumer puede deduplicar por id+stock).
        const threshold = item.punto_reorden ?? item.stock_minimo
        if (threshold !== null && threshold !== undefined && item.stock <= threshold) {
          emitWebhookEvent(organizationId!, "inventario.stock_bajo", {
            id: item.id,
            codigo: item.codigo,
            nombre: item.nombre,
            stock: item.stock,
            puntoReorden: item.punto_reorden,
            stockMinimo: item.stock_minimo,
          }).catch(() => {})
        }
      }
    }

    // Invalidar caché del catálogo público — items que linkean a este
    // inventario via inventario_id reflejan el stock real, deben refrescar.
    if (result.changed) {
      revalidateTag("catalogo", "max")
    }

    return NextResponse.json({
      stock: result.stock,
      changed: result.changed,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error adjusting stock:", error)
    return NextResponse.json(
      { error: "Error al ajustar stock" },
      { status: 500 }
    )
  }
}
