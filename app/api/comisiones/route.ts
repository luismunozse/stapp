import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { readCommissionRows, summarizeByBeneficiary } from "@/lib/commissions/rows"
import type { CommissionRole } from "@/lib/commissions/types"

const ROLES_BY_PARAM: Record<string, CommissionRole[]> = {
  TECNICO: ["TECNICO"],
  RECEPCION: ["RECEPCION"],
  todos: ["TECNICO", "RECEPCION"],
}

export async function GET(request: Request) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    let tecnicoId = searchParams.get("tecnicoId")
    const desde = searchParams.get("desde")
    const hasta = searchParams.get("hasta")
    const soloPendientes = searchParams.get("soloPendientes") === "true"
    const rolParam = searchParams.get("rol") ?? "TECNICO"
    if (!Object.hasOwn(ROLES_BY_PARAM, rolParam)) {
      return NextResponse.json({ error: "Rol inválido" }, { status: 400 })
    }
    const roles = ROLES_BY_PARAM[rolParam]

    // Un TECNICO solo puede ver sus propias comisiones
    if (role !== "ADMIN") {
      if (tecnicoId && tecnicoId !== userId) {
        return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
      }
      tecnicoId = userId
    }

    // The definition (DB views) owns which orders accrue, incl. the org flag.
    const rows = await readCommissionRows({
      organizationId: organizationId!,
      roles,
      beneficiarioId: tecnicoId,
      desde,
      hasta,
      estado: soloPendientes ? "pendiente" : "all",
    })

    // Obtener nombres de técnicos
    const tecnicoIds = Array.from(new Set(rows.map((r) => r.beneficiarioId).filter(Boolean)))
    const tecnicosMap = new Map<string, string>()
    if (tecnicoIds.length > 0) {
      const { data: tecs } = await supabaseAdmin
        .from("users")
        .select("id, nombre")
        .in("id", tecnicoIds)
        .eq("organization_id", organizationId!)
      ;(tecs || []).forEach((t) => tecnicosMap.set(t.id, t.nombre))
    }
    const nombreDe = (id: string) => tecnicosMap.get(id) || "Sin nombre"

    const items = rows.map((r) => ({
      clave: r.clave,
      ordenId: r.documentoId,
      tecnicoId: r.beneficiarioId,
      tecnicoNombre: nombreDe(r.beneficiarioId),
      rol: r.rol,
      tipo: r.tipo,
      pagoId: r.pagoId,
      pendiente: r.pendiente,
      codigoOrden: r.documentoCodigo,
      numeroOrden: r.documentoNumero,
      dispositivo: r.documentoDetalle,
      estado: r.documentoEstado,
      fechaCompletado: r.fechaDevengo,
      costoFinal: r.documentoTotal ?? 0,
      costoRepuestos: r.documentoCostoRepuestos ?? 0,
      ganancia: r.base ?? 0,
      // Optional, backward compatible: what the base was taken from.
      montoOrden: r.documentoMonto,
      baseTipo: r.baseTipo,
      porcentajeComision: r.porcentaje ?? 0,
      montoComision: r.monto,
      comisionPagada: r.pagado,
      fechaPagoComision: r.fechaPago,
    }))

    const resumen = summarizeByBeneficiary(rows).map((s) => ({
      tecnicoId: s.beneficiarioId,
      tecnicoNombre: nombreDe(s.beneficiarioId),
      totalOrdenes: s.originales,
      totalGanancia: s.base,
      totalComision: s.monto,
      totalPendiente: s.pendiente,
    }))

    return NextResponse.json({ items, resumen }, { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    console.error("Error fetching comisiones:", err)
    return NextResponse.json({ error: "Error al obtener comisiones" }, { status: 500 })
  }
}
