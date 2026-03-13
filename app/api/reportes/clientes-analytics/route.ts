import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { NextResponse } from "next/server"

export async function GET() {
  const { error, organizationId } = await requireAuth()
  if (error) return error

  const now = new Date()
  const hace30Dias = new Date(now)
  hace30Dias.setDate(now.getDate() - 30)
  const hace60Dias = new Date(now)
  hace60Dias.setDate(now.getDate() - 60)
  const hace90Dias = new Date(now)
  hace90Dias.setDate(now.getDate() - 90)
  const hace180Dias = new Date(now)
  hace180Dias.setDate(now.getDate() - 180)
  const hace6Meses = new Date(now)
  hace6Meses.setMonth(now.getMonth() - 6)

  try {
    const [clientesResult, ventasResult] = await Promise.all([
      supabaseAdmin
        .from("clientes")
        .select("id, nombre, telefono, email, created_at")
        .eq("organization_id", organizationId!),

      supabaseAdmin
        .from("ventas")
        .select("id, cliente_id, cliente_nombre, total, estado, created_at")
        .eq("organization_id", organizationId!)
        .eq("estado", "COMPLETADA"),
    ])

    const clientes = clientesResult.data || []
    const ventas = ventasResult.data || []

    // --- Aggregate ventas by client ---
    const clienteStats: Record<string, {
      id: string; nombre: string; telefono: string;
      totalCompras: number; totalGastado: number;
      ultimaCompra: string; primeraCompra: string;
    }> = {}

    ventas.forEach((v: any) => {
      const cid = v.cliente_id
      if (!cid) return
      if (!clienteStats[cid]) {
        const cliente = clientes.find(c => c.id === cid)
        clienteStats[cid] = {
          id: cid,
          nombre: cliente?.nombre || v.cliente_nombre || "Sin nombre",
          telefono: cliente?.telefono || "",
          totalCompras: 0,
          totalGastado: 0,
          ultimaCompra: v.created_at,
          primeraCompra: v.created_at,
        }
      }
      clienteStats[cid].totalCompras++
      clienteStats[cid].totalGastado += v.total || 0
      if (v.created_at > clienteStats[cid].ultimaCompra) clienteStats[cid].ultimaCompra = v.created_at
      if (v.created_at < clienteStats[cid].primeraCompra) clienteStats[cid].primeraCompra = v.created_at
    })

    const allClienteStats = Object.values(clienteStats)
    const nowMs = now.getTime()

    // --- Segmentación ---
    type Segment = "VIP" | "FRECUENTE" | "REGULAR" | "NUEVO" | "INACTIVO"
    const segments: Record<Segment, { count: number; totalGastado: number; clientes: any[] }> = {
      VIP: { count: 0, totalGastado: 0, clientes: [] },
      FRECUENTE: { count: 0, totalGastado: 0, clientes: [] },
      REGULAR: { count: 0, totalGastado: 0, clientes: [] },
      NUEVO: { count: 0, totalGastado: 0, clientes: [] },
      INACTIVO: { count: 0, totalGastado: 0, clientes: [] },
    }

    allClienteStats.forEach(c => {
      const diasDesdeUltima = Math.floor((nowMs - new Date(c.ultimaCompra).getTime()) / (1000 * 60 * 60 * 24))
      let segment: Segment

      if (c.totalCompras >= 5 && diasDesdeUltima <= 30) {
        segment = "VIP"
      } else if (c.totalCompras >= 3 && diasDesdeUltima <= 60) {
        segment = "FRECUENTE"
      } else if (c.totalCompras === 1 && diasDesdeUltima <= 30) {
        segment = "NUEVO"
      } else if (diasDesdeUltima > 90) {
        segment = "INACTIVO"
      } else {
        segment = "REGULAR"
      }

      segments[segment].count++
      segments[segment].totalGastado += c.totalGastado
      segments[segment].clientes.push({
        id: c.id,
        nombre: c.nombre,
        totalCompras: c.totalCompras,
        totalGastado: c.totalGastado,
        ultimaCompra: c.ultimaCompra,
      })
    })

    // Sort clients within each segment by totalGastado and limit to 10
    Object.values(segments).forEach(seg => {
      seg.clientes.sort((a: any, b: any) => b.totalGastado - a.totalGastado)
      seg.clientes = seg.clientes.slice(0, 10)
    })

    // --- Top Clientes ---
    const topClientes = allClienteStats
      .map(c => {
        const diasDesdeUltima = Math.floor((nowMs - new Date(c.ultimaCompra).getTime()) / (1000 * 60 * 60 * 24))
        return {
          id: c.id,
          nombre: c.nombre,
          totalCompras: c.totalCompras,
          totalGastado: c.totalGastado,
          ticketPromedio: c.totalCompras > 0 ? Math.round(c.totalGastado / c.totalCompras) : 0,
          ultimaCompra: c.ultimaCompra,
          diasDesdeUltimaCompra: diasDesdeUltima,
        }
      })
      .sort((a, b) => b.totalGastado - a.totalGastado)
      .slice(0, 10)

    // --- Clientes en Riesgo ---
    const clientesEnRiesgo = allClienteStats
      .filter(c => {
        const dias = Math.floor((nowMs - new Date(c.ultimaCompra).getTime()) / (1000 * 60 * 60 * 24))
        return c.totalCompras >= 2 && dias >= 60 && dias <= 180
      })
      .map(c => ({
        id: c.id,
        nombre: c.nombre,
        telefono: c.telefono,
        totalCompras: c.totalCompras,
        totalGastado: c.totalGastado,
        ultimaCompra: c.ultimaCompra,
        diasInactivo: Math.floor((nowMs - new Date(c.ultimaCompra).getTime()) / (1000 * 60 * 60 * 24)),
      }))
      .sort((a, b) => b.diasInactivo - a.diasInactivo)

    // --- Adquisición Mensual (últimos 6 meses) ---
    const mesesMap: Record<string, number> = {}
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      mesesMap[key] = 0
    }
    clientes.forEach((c: any) => {
      if (!c.created_at) return
      const d = new Date(c.created_at)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      if (mesesMap[key] !== undefined) mesesMap[key]++
    })
    const adquisicionMensual = Object.entries(mesesMap).map(([mes, count]) => ({ mes, count }))

    // --- Frecuencia de Compra ---
    const frecRanges = [
      { rango: "1 compra", min: 1, max: 1 },
      { rango: "2 compras", min: 2, max: 2 },
      { rango: "3-5 compras", min: 3, max: 5 },
      { rango: "6-10 compras", min: 6, max: 10 },
      { rango: "10+ compras", min: 11, max: Infinity },
    ]
    const frecuenciaCompra = frecRanges.map(r => ({
      rango: r.rango,
      count: allClienteStats.filter(c => c.totalCompras >= r.min && c.totalCompras <= r.max).length,
    }))

    return NextResponse.json({
      segmentacion: segments,
      topClientes,
      clientesEnRiesgo,
      adquisicionMensual,
      frecuenciaCompra,
    })
  } catch (err) {
    console.error("Error en clientes-analytics:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
