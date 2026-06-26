import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { fetchMovimientosDia, computeTotales } from "@/lib/caja-utils"
import { sucursalParaLectura } from "@/lib/sucursal"
import { supabaseAdmin } from "@/lib/supabase"
import { DEFAULT_TIMEZONE } from "@/lib/timezone"

const METODO_LABELS: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA_DEBITO: "Tarjeta Débito",
  TARJETA_CREDITO: "Tarjeta Crédito",
  MERCADOPAGO: "MercadoPago",
  CUENTA_CORRIENTE: "Cuenta Corriente",
  OTRO: "Otro",
}

const TIPO_LABELS: Record<string, string> = {
  COBRO_ORDEN: "Cobro de Orden",
  PAGO_FACTURA: "Pago Factura",
  PAGO_VENTA: "Venta",
  DEPOSITO_CUENTA: "Depósito a Cuenta",
  INGRESO_MANUAL: "Ingreso Manual",
  EGRESO_MANUAL: "Egreso Manual",
}

function escapeCsv(value: string | null | undefined): string {
  if (value == null) return ""
  let str = String(value)
  // Neutralize CSV formula injection: prefix with ' when value starts with =,+,-,@,tab,CR
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str
  }
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

// GET - Exportar movimientos del día a CSV
export async function GET(request: Request) {
  try {
    const { error, session, role, organizationId } = await requireAdmin()
    if (error) return error

    const filtro = await sucursalParaLectura({
      role: role ?? null,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    const sid = filtro.verTodas ? null : filtro.sucursalId

    // Fail-safe: un lookup de zona horaria nunca debe tumbar el export.
    let tz = DEFAULT_TIMEZONE
    try {
      const { data: orgTz } = await supabaseAdmin
        .from("organizations")
        .select("zona_horaria")
        .eq("id", organizationId!)
        .single()
      if (orgTz?.zona_horaria) tz = orgTz.zona_horaria
    } catch {
      // queda DEFAULT_TIMEZONE
    }

    const { searchParams } = new URL(request.url)
    const fecha = searchParams.get("fecha") || new Date().toISOString().split("T")[0]
    const fechaDesde = `${fecha}T00:00:00`
    const fechaHasta = `${fecha}T23:59:59`

    const movimientos = await fetchMovimientosDia(organizationId!, fechaDesde, fechaHasta, undefined, sid)
    const totales = computeTotales(movimientos)

    const headers = ["Hora", "Tipo", "Método de Pago", "Monto", "Referencia", "Observaciones"]
    const rows = movimientos.map((m) => [
      new Date(m.fecha).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: tz }),
      TIPO_LABELS[m.tipo] || m.tipo,
      METODO_LABELS[m.metodoPago] || m.metodoPago,
      m.esEgreso ? `-${m.monto.toFixed(2)}` : m.monto.toFixed(2),
      m.referencia,
      m.observaciones,
    ])

    // Agregar línea de totales
    rows.push([])
    rows.push(["", "TOTAL DEL DÍA", "", totales.totalDia.toFixed(2), "", ""])
    rows.push(["", "Total Ingresos", "", totales.totalIngresos.toFixed(2), "", ""])
    rows.push(["", "Total Egresos", "", totales.totalEgresos.toFixed(2), "", ""])

    const csv = [
      headers.map(escapeCsv).join(","),
      ...rows.map((row) => row.map(escapeCsv).join(",")),
    ].join("\n")

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="caja-${fecha}.csv"`,
      },
    })
  } catch (err) {
    console.error("Error exporting caja:", err)
    return NextResponse.json({ error: "Error al exportar" }, { status: 500 })
  }
}
