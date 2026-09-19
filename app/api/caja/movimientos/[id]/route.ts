import { NextResponse } from "next/server"
import { requireCajaAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { logAudit } from "@/lib/audit"

/**
 * DELETE — anula un movimiento manual de caja.
 *
 * POR QUÉ YA NO BORRA (auditoría contable, punto 1.6)
 *
 * Antes esto hacía un delete físico: la fila desaparecía y no quedaba quién
 * la dio de baja, cuándo, ni cuánto decía. Los movimientos de plata eran lo
 * único del sistema sin rastro — órdenes, clientes, inventario y ventas ya se
 * auditaban.
 *
 * El agujero concreto: el único freno era que la sesión estuviera CERRADA,
 * pero el alta permite cargar un movimiento sin caja abierta (sesion_caja_id
 * NULL). Ese movimiento NO tenía sesión que lo protegiera, así que se podía
 * borrar meses después y cambiar la ganancia de un mes ya reportado.
 *
 * Ahora la fila se marca `anulado = true` con usuario y fecha, se registra en
 * la auditoría, y todos los lectores (arqueo, listado del día, Estado de
 * Resultados, tendencia) la filtran. Para el usuario el efecto es el mismo:
 * el movimiento deja de contar. La diferencia es que queda el rastro.
 *
 * El verbo sigue siendo DELETE para no romper al cliente que ya lo llama.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role, session } = await requireCajaAccess()
    if (error) return error

    const { id } = await params

    let motivo: string | null = null
    try {
      const body = await request.json()
      if (typeof body?.motivo === "string" && body.motivo.trim()) {
        motivo = body.motivo.trim().slice(0, 500)
      }
    } catch {
      // Sin body: el cliente actual no manda motivo. No es obligatorio.
    }

    // Fetch movimiento with its session state for guards
    const { data: movimiento } = await supabaseAdmin
      .from("movimientos_caja")
      .select("id, tipo, monto, concepto, metodo_pago, fecha, anulado, sucursal_id, sesion_caja_id, sesiones_caja:sesion_caja_id(id, estado)")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (!movimiento) {
      return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 })
    }

    // Ya anulado: idempotente, pero sin registrar una segunda auditoría.
    if ((movimiento as any).anulado) {
      return NextResponse.json({ ok: true, yaAnulado: true })
    }

    // Guard: cannot delete from a closed session
    const sesionEstado = (movimiento as any).sesiones_caja?.estado
    if (sesionEstado === "CERRADA") {
      return NextResponse.json(
        { error: "No se puede anular un movimiento de una sesión cerrada" },
        { status: 400 }
      )
    }

    // Guard: sucursal scope — branch users can only delete from their own branch
    const filtro = await sucursalParaLectura({
      role,
      userSucursalId: session!.user.sucursalId ?? null,
    })

    if (!filtro.verTodas && filtro.sucursalId) {
      if ((movimiento as any).sucursal_id !== filtro.sucursalId) {
        return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 })
      }
    }

    // `.eq("anulado", false)` es el lock optimista: si dos pedidos llegan
    // juntos, sólo uno escribe y el otro ve 0 filas afectadas.
    const { data: anuladas, error: updateError } = await supabaseAdmin
      .from("movimientos_caja")
      .update({
        anulado: true,
        anulado_at: new Date().toISOString(),
        anulado_por: userId!,
        anulado_motivo: motivo,
      })
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .eq("anulado", false)
      .select("id")

    if (updateError) {
      console.error("Error anulando movimiento:", updateError)
      return NextResponse.json({ error: "Error al anular movimiento" }, { status: 500 })
    }

    if (!anuladas || anuladas.length === 0) {
      return NextResponse.json({ ok: true, yaAnulado: true })
    }

    // La auditoría no bloquea la operación (logAudit se traga sus errores),
    // pero deja el "quién y cuándo" que antes no existía.
    await logAudit({
      organizationId: organizationId!,
      userId: userId!,
      action: "DELETE",
      entity: "movimientos_caja",
      entityId: id,
      changes: {
        before: {
          tipo: (movimiento as any).tipo,
          monto: (movimiento as any).monto,
          concepto: (movimiento as any).concepto,
          metodo_pago: (movimiento as any).metodo_pago,
          fecha: (movimiento as any).fecha,
        },
        after: { anulado: true, anulado_motivo: motivo },
      },
      description: `Anuló ${(movimiento as any).tipo === "EGRESO" ? "un egreso" : "un ingreso"} de caja de ${(movimiento as any).monto} (${(movimiento as any).concepto})${motivo ? ` — ${motivo}` : ""}`,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Error anulando movimiento:", err)
    return NextResponse.json({ error: "Error al anular movimiento" }, { status: 500 })
  }
}
