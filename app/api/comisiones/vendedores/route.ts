import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { readCommissionRows, summarizeByBeneficiary } from "@/lib/commissions/rows"

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const vendedorId = searchParams.get("vendedorId")
    const desde = searchParams.get("desde")
    const hasta = searchParams.get("hasta")
    const soloPendientes = searchParams.get("soloPendientes") === "true"

    // The definition (DB views) owns what accrues, incl. post-payment adjustments.
    const rows = await readCommissionRows({
      organizationId: organizationId!,
      roles: ["VENDEDOR"],
      beneficiarioId: vendedorId && vendedorId !== "all" ? vendedorId : null,
      desde,
      hasta,
      estado: soloPendientes ? "pendiente" : "all",
    })

    const vendedorIds = Array.from(new Set(rows.map((r) => r.beneficiarioId).filter(Boolean)))
    const vendedoresMap = new Map<string, string>()
    if (vendedorIds.length > 0) {
      const { data: vs } = await supabaseAdmin
        .from("users")
        .select("id, nombre")
        .in("id", vendedorIds)
        .eq("organization_id", organizationId!)
      ;(vs || []).forEach((v) => vendedoresMap.set(v.id, v.nombre))
    }
    const nombreDe = (id: string) => vendedoresMap.get(id) || "Sin nombre"

    const items = rows.map((r) => ({
      clave: r.clave,
      ventaId: r.documentoId,
      vendedorId: r.beneficiarioId,
      vendedorNombre: nombreDe(r.beneficiarioId),
      tipo: r.tipo,
      pagoId: r.pagoId,
      pendiente: r.pendiente,
      numeroVenta: r.documentoNumero,
      clienteNombre: r.documentoDetalle,
      fecha: r.fechaDevengo,
      total: r.documentoTotal ?? 0,
      porcentajeComision: r.porcentaje ?? 0,
      montoComision: r.monto,
      comisionPagada: r.pagado,
      fechaPagoComision: r.fechaPago,
    }))

    const resumen = summarizeByBeneficiary(rows).map((s) => ({
      vendedorId: s.beneficiarioId,
      vendedorNombre: nombreDe(s.beneficiarioId),
      totalVentas: s.originales,
      totalFacturado: s.documentoTotal,
      totalComision: s.monto,
      totalPendiente: s.pendiente,
    }))

    return NextResponse.json({ items, resumen }, { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    console.error("Error fetching comisiones vendedores:", err)
    return NextResponse.json(
      { error: "Error al obtener comisiones de vendedores" },
      { status: 500 }
    )
  }
}
