import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { traerTodas } from "@/lib/supabase-paginar"
import { NextResponse } from "next/server"

export async function GET() {
  const { error, organizationId, role, session } = await requireAdminOrVendedor()
  if (error) return error

  const filtro = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })

  const now = new Date()
  const en30Dias = new Date(now)
  en30Dias.setDate(now.getDate() + 30)
  const hace30Dias = new Date(now)
  hace30Dias.setDate(now.getDate() - 30)

  try {
    // Build base garantias queries — filter via ventas!inner when a branch is active.
    // Sin las de ventas anuladas: esa garantía no existe (la venta se deshizo).
    const sucursalId = !filtro.verTodas && filtro.sucursalId ? filtro.sucursalId : null

    let porVencerQuery = supabaseAdmin
      .from("garantias_venta")
      .select(`
        id, numero_garantia, dias_validez, fecha_inicio, fecha_vencimiento, estado,
        items_venta!inner(descripcion, cantidad, precio_unitario),
        ventas!inner(numero_venta, cliente_nombre, cliente_telefono, organization_id, sucursal_id, estado)
      `)
      .eq("ventas.organization_id", organizationId!)
      .neq("ventas.estado", "ANULADA")
      .eq("estado", "ACTIVA")
      .gte("fecha_vencimiento", now.toISOString())
      .lte("fecha_vencimiento", en30Dias.toISOString())
      .order("fecha_vencimiento", { ascending: true })
    if (sucursalId) porVencerQuery = porVencerQuery.eq("ventas.sucursal_id", sucursalId)

    // Una sola lectura para el resumen, la tasa de reclamo y la distribución,
    // paginada: con más de 1000 garantías PostgREST cortaba en silencio.
    // dias_validez y fecha_vencimiento no se pedían: la distribución salía
    // toda en "0 días" y las vencidas en 0.
    const todasGarantiasQuery = () => {
      let q = supabaseAdmin
        .from("garantias_venta")
        .select(`
          id, estado, numero_garantia, dias_validez, fecha_inicio, fecha_vencimiento, created_at,
          items_venta!inner(descripcion),
          ventas!inner(numero_venta, cliente_nombre, organization_id, sucursal_id, estado)
        `)
        .eq("ventas.organization_id", organizationId!)
        .neq("ventas.estado", "ANULADA")
        .order("id")
      if (sucursalId) q = q.eq("ventas.sucursal_id", sucursalId)
      return q
    }

    const [porVencerResult, todasGarantiasResult] = await Promise.all([
      porVencerQuery,
      traerTodas(todasGarantiasQuery),
    ])

    // --- Resumen ---
    // Nadie pasa las garantías a VENCIDA: una ACTIVA con la fecha cumplida
    // está vencida aunque el estado no lo diga.
    const todas = todasGarantiasResult.data as any[]
    const vencidaPorFecha = (g: any) =>
      g.estado === "ACTIVA" && g.fecha_vencimiento && new Date(g.fecha_vencimiento) < now
    const resumen = {
      totalActivas: todas.filter(g => g.estado === "ACTIVA" && !vencidaPorFecha(g)).length,
      totalVencidas: todas.filter(g => g.estado === "VENCIDA" || vencidaPorFecha(g)).length,
      totalReclamadas: todas.filter(g => g.estado === "RECLAMADA").length,
      // Retiradas por devolución (migración 316). Sin este bucket los otros tres
      // no cierran contra totalGarantias y la diferencia no la explica nadie.
      totalAnuladas: todas.filter(g => g.estado === "ANULADA").length,
      totalGarantias: todas.length,
    }

    // --- Por Vencer ---
    const porVencerData = porVencerResult.data || []
    const porVencer = porVencerData.map((g: any) => {
      const fechaVenc = new Date(g.fecha_vencimiento)
      const diasRestantes = Math.ceil((fechaVenc.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      return {
        id: g.id,
        numeroGarantia: g.numero_garantia,
        producto: (g.items_venta as any)?.descripcion || "Sin descripción",
        clienteNombre: (g.ventas as any)?.cliente_nombre || "Sin cliente",
        clienteTelefono: (g.ventas as any)?.cliente_telefono || null,
        numeroVenta: (g.ventas as any)?.numero_venta,
        fechaInicio: g.fecha_inicio,
        fechaVencimiento: g.fecha_vencimiento,
        diasRestantes,
        diasValidez: g.dias_validez,
      }
    })

    // --- Tasa de Reclamo por Producto ---
    const todasGarantias = todas
    const productoMap: Record<string, { producto: string; totalGarantias: number; totalReclamadas: number }> = {}
    todasGarantias.forEach((g: any) => {
      // Una garantía ANULADA se retiró al devolverse el producto: nunca pudo
      // reclamarse, así que en el denominador solo diluye la tasa real.
      if (g.estado === "ANULADA") return
      const prod = (g.items_venta as any)?.descripcion || "Sin descripción"
      if (!productoMap[prod]) productoMap[prod] = { producto: prod, totalGarantias: 0, totalReclamadas: 0 }
      productoMap[prod].totalGarantias++
      if (g.estado === "RECLAMADA") productoMap[prod].totalReclamadas++
    })
    const tasaReclamo = Object.values(productoMap)
      .map(p => ({
        ...p,
        tasaReclamo: p.totalGarantias > 0 ? Math.round((p.totalReclamadas / p.totalGarantias) * 10000) / 100 : 0,
      }))
      .filter(p => p.totalGarantias >= 2) // at least 2 warranties to be significant
      .sort((a, b) => b.tasaReclamo - a.tasaReclamo)
      .slice(0, 10)

    // --- Reclamos Recientes ---
    const reclamosRecientes = todasGarantias
      .filter((g: any) => g.estado === "RECLAMADA")
      .sort((a: any, b: any) => (b.created_at || "").localeCompare(a.created_at || ""))
      .slice(0, 10)
      .map((g: any) => ({
        id: g.id,
        numeroGarantia: g.numero_garantia,
        producto: (g.items_venta as any)?.descripcion || "Sin descripción",
        clienteNombre: (g.ventas as any)?.cliente_nombre || "Sin cliente",
        numeroVenta: (g.ventas as any)?.numero_venta,
        fechaReclamo: g.created_at,
      }))

    // --- Distribución por Días ---
    const diasMap: Record<number, number> = {}
    todasGarantias.forEach((g: any) => {
      const dias = g.dias_validez || 0
      // Bucket into common ranges
      let bucket = dias
      if (dias <= 0) bucket = 0
      else if (dias <= 30) bucket = 30
      else if (dias <= 60) bucket = 60
      else if (dias <= 90) bucket = 90
      else if (dias <= 180) bucket = 180
      else if (dias <= 365) bucket = 365
      else bucket = 366

      if (!diasMap[bucket]) diasMap[bucket] = 0
      diasMap[bucket]++
    })
    const distribucionDias = Object.entries(diasMap)
      .map(([dias, count]) => ({ dias: Number(dias), count }))
      .sort((a, b) => a.dias - b.dias)

    return NextResponse.json({
      resumen,
      porVencer,
      tasaReclamo,
      reclamosRecientes,
      distribucionDias,
    })
  } catch (err) {
    console.error("Error en garantias-ventas:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
