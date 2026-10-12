import { NextResponse } from "next/server"
import { requireCajaAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { esErrorColumnaOrigen, esOrigenNoEliminable, resolverOrigen } from "@/lib/caja-utils"

// DELETE - Eliminar movimiento manual
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role, session } = await requireCajaAccess()
    if (error) return error

    const { id } = await params

    // Fetch movimiento with its session state for guards
    const selectMovimiento = (columnas: string) =>
      supabaseAdmin
        .from("movimientos_caja")
        .select(columnas)
        .eq("id", id)
        .eq("organization_id", organizationId!)
        .single()

    const sesion = "sesiones_caja:sesion_caja_id(id, estado)"
    let { data: movimiento, error: fetchError } = await selectMovimiento(
      `id, sucursal_id, sesion_caja_id, origen, ${sesion}`
    )
    // Mig 335 sin aplicar: sin la columna origen, el origen se deduce del
    // concepto (resolverOrigen) para que el guard siga funcionando.
    if (fetchError && esErrorColumnaOrigen(fetchError)) {
      ;({ data: movimiento, error: fetchError } = await selectMovimiento(
        `id, sucursal_id, sesion_caja_id, tipo, afecta_rentabilidad, es_recurrente, concepto, ${sesion}`
      ))
    }

    if (!movimiento) {
      return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 })
    }

    // Guard: cannot delete from a closed session
    const sesionEstado = (movimiento as any).sesiones_caja?.estado
    if (sesionEstado === "CERRADA") {
      return NextResponse.json(
        { error: "No se puede eliminar un movimiento de una sesión cerrada" },
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

    // Guard: las filas que escribe el sistema (egreso de devolucion / nota de
    // credito, COGS) no se borran desde caja: el reembolso quedaria registrado
    // sin su salida de efectivo y el arqueo mostraria un sobrante fantasma.
    if (esOrigenNoEliminable(resolverOrigen(movimiento as any))) {
      return NextResponse.json(
        {
          error:
            "Este movimiento lo generó el sistema (devolución o nota de crédito) y no se puede eliminar desde caja.",
        },
        { status: 409 }
      )
    }

    const { error: deleteError } = await supabaseAdmin
      .from("movimientos_caja")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId!)

    if (deleteError) {
      console.error("Error deleting movimiento:", deleteError)
      return NextResponse.json({ error: "Error al eliminar movimiento" }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Error deleting movimiento:", err)
    return NextResponse.json({ error: "Error al eliminar movimiento" }, { status: 500 })
  }
}
