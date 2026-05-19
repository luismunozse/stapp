import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// GET /api/inventario/reposicion?coberturaDias=30&soloCriticos=true
// Devuelve sugerencias agrupadas por proveedor.
export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const cobertura = Math.max(1, Math.min(180, parseInt(searchParams.get("coberturaDias") || "30")))
    const soloCriticos = searchParams.get("soloCriticos") === "true"

    const { data, error: rpcErr } = await supabaseAdmin.rpc("calcular_reposicion_sugerida", {
      p_organization_id: organizationId!,
      p_cobertura_dias: cobertura,
      p_solo_criticos: soloCriticos,
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
      leadTimeDias: number | null
      stockActual: number
      stockMinimo: number | null
      puntoReorden: number | null
      stockMaximo: number | null
      umbralAplicado: number
      demanda30d: number
      demandaDiariaAvg: number
      diasStockRestante: number | null
      cantidadSugerida: number
      precioCompra: number
      costoEstimado: number
      prioridad: "CRITICA" | "ALTA" | "MEDIA" | "BAJA"
    }

    const rows: Row[] = (data || []).map((r: any) => ({
      inventarioId: r.inventario_id,
      codigo: r.codigo,
      nombre: r.nombre,
      categoria: r.categoria,
      tipoDispositivo: r.tipo_dispositivo,
      proveedorId: r.proveedor_id,
      proveedorNombre: r.proveedor_nombre,
      leadTimeDias: r.lead_time_dias,
      stockActual: r.stock_actual,
      stockMinimo: r.stock_minimo,
      puntoReorden: r.punto_reorden,
      stockMaximo: r.stock_maximo,
      umbralAplicado: r.umbral_aplicado,
      demanda30d: r.demanda_30d,
      demandaDiariaAvg: Number(r.demanda_diaria_avg),
      diasStockRestante: r.dias_stock_restante !== null ? Number(r.dias_stock_restante) : null,
      cantidadSugerida: r.cantidad_sugerida,
      precioCompra: Number(r.precio_compra ?? 0),
      costoEstimado: Number(r.costo_estimado),
      prioridad: r.prioridad as "CRITICA" | "ALTA" | "MEDIA" | "BAJA",
    }))

    // Agrupar por proveedor
    const grupos = new Map<string, { proveedorId: string | null; proveedorNombre: string | null; leadTimeDias: number | null; items: typeof rows; subtotal: number }>()
    for (const r of rows) {
      const key = r.proveedorId || "__sin_proveedor__"
      let g = grupos.get(key)
      if (!g) {
        g = {
          proveedorId: r.proveedorId,
          proveedorNombre: r.proveedorNombre,
          leadTimeDias: r.leadTimeDias,
          items: [],
          subtotal: 0,
        }
        grupos.set(key, g)
      }
      g.items.push(r)
      g.subtotal += r.costoEstimado
    }

    const totales = {
      items: rows.length,
      criticos: rows.filter((r) => r.prioridad === "CRITICA").length,
      altos: rows.filter((r) => r.prioridad === "ALTA").length,
      costoTotal: rows.reduce((s, r) => s + r.costoEstimado, 0),
    }

    return NextResponse.json({
      coberturaDias: cobertura,
      totales,
      proveedores: Array.from(grupos.values()),
    })
  } catch (err) {
    console.error("Error calculating reposicion:", err)
    return NextResponse.json({ error: "Error al calcular reposición" }, { status: 500 })
  }
}
