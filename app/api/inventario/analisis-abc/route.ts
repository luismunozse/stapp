import { NextResponse } from "next/server"
import { requireInventarioAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// GET /api/inventario/analisis-abc?dias=90&diasMuerto=90
// Devuelve análisis ABC + rotación por item, con totales agregados.
export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireInventarioAccess()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const dias = Math.max(7, Math.min(365, parseInt(searchParams.get("dias") || "90")))
    const diasMuerto = Math.max(30, Math.min(365, parseInt(searchParams.get("diasMuerto") || "90")))

    const { data, error: rpcErr } = await supabaseAdmin.rpc("analisis_abc_rotacion", {
      p_organization_id: organizationId!,
      p_dias: dias,
      p_dias_muerto: diasMuerto,
    })

    if (rpcErr) throw rpcErr

    type Row = {
      inventarioId: string
      codigo: string
      nombre: string
      categoria: string
      tipoDispositivo: string
      proveedorId: string | null
      proveedorNombre: string | null
      stockActual: number
      precioCompra: number
      precioVenta: number
      capitalInmovilizado: number
      qtyVendida: number
      revenue: number
      margenUnitario: number
      margenTotal: number
      ventasCount: number
      ultimaVentaAt: string | null
      diasSinVenta: number | null
      rotacion: number
      diasPromedioStock: number | null
      pctRevenue: number
      pctRevenueAcumulado: number
      clasificacionAbc: "A" | "B" | "C" | "SIN_VENTAS"
      clasificacionRotacion: "ALTA" | "MEDIA" | "BAJA" | "MUERTA" | "NUEVA"
    }

    const rows: Row[] = (data || []).map((r: any) => ({
      inventarioId: r.inventario_id,
      codigo: r.codigo,
      nombre: r.nombre,
      categoria: r.categoria,
      tipoDispositivo: r.tipo_dispositivo,
      proveedorId: r.proveedor_id,
      proveedorNombre: r.proveedor_nombre,
      stockActual: r.stock_actual,
      precioCompra: Number(r.precio_compra ?? 0),
      precioVenta: Number(r.precio_venta ?? 0),
      capitalInmovilizado: Number(r.capital_inmovilizado ?? 0),
      qtyVendida: r.qty_vendida,
      revenue: Number(r.revenue ?? 0),
      margenUnitario: Number(r.margen_unitario ?? 0),
      margenTotal: Number(r.margen_total ?? 0),
      ventasCount: r.ventas_count,
      ultimaVentaAt: r.ultima_venta_at,
      diasSinVenta: r.dias_sin_venta,
      rotacion: Number(r.rotacion ?? 0),
      diasPromedioStock: r.dias_promedio_stock !== null ? Number(r.dias_promedio_stock) : null,
      pctRevenue: Number(r.pct_revenue ?? 0),
      pctRevenueAcumulado: Number(r.pct_revenue_acumulado ?? 0),
      clasificacionAbc: r.clasificacion_abc,
      clasificacionRotacion: r.clasificacion_rotacion,
    }))

    // Totales agregados
    const totales = {
      items: rows.length,
      revenue: rows.reduce((s, r) => s + r.revenue, 0),
      margenTotal: rows.reduce((s, r) => s + r.margenTotal, 0),
      capitalInmovilizado: rows.reduce((s, r) => s + r.capitalInmovilizado, 0),
      capitalMuerto: rows
        .filter((r) => r.clasificacionRotacion === "MUERTA")
        .reduce((s, r) => s + r.capitalInmovilizado, 0),
    }

    const porAbc = {
      A: rows.filter((r) => r.clasificacionAbc === "A"),
      B: rows.filter((r) => r.clasificacionAbc === "B"),
      C: rows.filter((r) => r.clasificacionAbc === "C"),
      SIN_VENTAS: rows.filter((r) => r.clasificacionAbc === "SIN_VENTAS"),
    }

    const porRotacion = {
      ALTA: rows.filter((r) => r.clasificacionRotacion === "ALTA").length,
      MEDIA: rows.filter((r) => r.clasificacionRotacion === "MEDIA").length,
      BAJA: rows.filter((r) => r.clasificacionRotacion === "BAJA").length,
      MUERTA: rows.filter((r) => r.clasificacionRotacion === "MUERTA").length,
      NUEVA: rows.filter((r) => r.clasificacionRotacion === "NUEVA").length,
    }

    return NextResponse.json({
      periodo: { dias, diasMuerto },
      totales,
      resumenAbc: {
        A: { count: porAbc.A.length, revenue: porAbc.A.reduce((s, r) => s + r.revenue, 0) },
        B: { count: porAbc.B.length, revenue: porAbc.B.reduce((s, r) => s + r.revenue, 0) },
        C: { count: porAbc.C.length, revenue: porAbc.C.reduce((s, r) => s + r.revenue, 0) },
        SIN_VENTAS: {
          count: porAbc.SIN_VENTAS.length,
          capitalInmovilizado: porAbc.SIN_VENTAS.reduce((s, r) => s + r.capitalInmovilizado, 0),
        },
      },
      resumenRotacion: porRotacion,
      data: rows,
    })
  } catch (err) {
    console.error("Error in analisis-abc:", err)
    return NextResponse.json({ error: "Error al calcular análisis" }, { status: 500 })
  }
}
