import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// GET /api/inventario/[id]/depositos
// Devuelve stock split por depósito para un item. Incluye depósitos sin stock
// (filas faltantes) para que la UI pueda mostrar opción de transferencia.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    // Validar pertenencia
    const { data: item, error: itemErr } = await supabaseAdmin
      .from("inventario")
      .select("id, nombre, stock, stock_reservado")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (itemErr || !item) {
      return NextResponse.json({ error: "Item no encontrado" }, { status: 404 })
    }

    const { data: depositos } = await supabaseAdmin
      .from("depositos")
      .select("id, nombre, principal, activo, sucursal_id, sucursales(id, nombre)")
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .order("principal", { ascending: false })
      .order("nombre", { ascending: true })

    const { data: stockRows } = await supabaseAdmin
      .from("inventario_depositos")
      .select("deposito_id, stock, stock_reservado")
      .eq("inventario_id", id)
      .eq("organization_id", organizationId!)

    const stockMap = new Map<string, { stock: number; stockReservado: number }>()
    for (const r of stockRows || []) {
      stockMap.set(r.deposito_id, {
        stock: r.stock ?? 0,
        stockReservado: r.stock_reservado ?? 0,
      })
    }

    const data = (depositos || []).map((d: any) => {
      const s = stockMap.get(d.id) ?? { stock: 0, stockReservado: 0 }
      // sucursales may come back as an object or array from PostgREST join
      const sucursalRow = Array.isArray(d.sucursales) ? d.sucursales[0] : d.sucursales
      return {
        depositoId: d.id,
        depositoNombre: d.nombre,
        principal: d.principal,
        activo: d.activo,
        sucursalId: d.sucursal_id ?? null,
        sucursalNombre: sucursalRow?.nombre ?? null,
        stock: s.stock,
        stockReservado: s.stockReservado,
        disponible: Math.max(0, s.stock - s.stockReservado),
      }
    })

    const totalSplit = data.reduce((acc, r) => acc + r.stock, 0)

    return NextResponse.json({
      item: { id: item.id, nombre: item.nombre, stockTotal: item.stock ?? 0 },
      data,
      // discrepancia entre suma por depósito y total agregado: indica que
      // hubo movimientos no-multi-depósito (ventas/reservas pre-fase 2).
      // La UI lo muestra como advertencia.
      discrepancia: (item.stock ?? 0) - totalSplit,
    })
  } catch (err) {
    console.error("Error fetching item depositos:", err)
    return NextResponse.json({ error: "Error al obtener stock por depósito" }, { status: 500 })
  }
}
