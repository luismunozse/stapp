import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { readCommissionRows } from "@/lib/commissions/rows"
import { round2 } from "@/lib/precios"

type EstadoFiltro = "pendiente" | "pagada" | "all"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // El id del vendedor viaja en la URL: con requireAuth cualquier rol leia
    // lo que gana CUALQUIER vendedor —ventas, porcentaje, montos, si ya se le
    // pago— cambiando un id. La pantalla que la consume es la liquidacion,
    // que ya era admin-only en el middleware.
    //
    // Esto NO es 'mis comisiones'. Si mañana el vendedor tiene que ver las
    // propias, va por una ruta que se scopee sola, como ya hace
    // GET /api/comisiones con el tecnico.
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const { searchParams } = new URL(request.url)
    const estadoParam = searchParams.get("estado") || "all"
    const estado: EstadoFiltro =
      estadoParam === "pendiente" || estadoParam === "pagada" ? estadoParam : "all"
    const desde = searchParams.get("desde")
    const hasta = searchParams.get("hasta")

    const rows = await readCommissionRows({
      organizationId: organizationId!,
      roles: ["VENDEDOR"],
      beneficiarioId: id,
      desde,
      hasta,
      estado,
    })

    const comisiones = rows.map((r) => ({
      clave: r.clave,
      ventaId: r.documentoId,
      tipo: r.tipo,
      pagoId: r.pagoId,
      numeroVenta: r.documentoNumero,
      clienteNombre: r.documentoDetalle,
      fecha: r.fechaDevengo,
      total: r.documentoTotal ?? 0,
      porcentajeComision: r.porcentaje ?? 0,
      montoComision: r.monto,
      pagada: r.pagado,
      fechaPago: r.fechaPago,
    }))

    const totales = comisiones.reduce(
      (acc, c) => {
        acc.devengada += c.montoComision
        if (c.pagada) acc.pagada += c.montoComision
        else acc.pendiente += c.montoComision
        return acc
      },
      { devengada: 0, pagada: 0, pendiente: 0 }
    )

    return NextResponse.json({
      comisiones,
      totales: {
        devengada: round2(totales.devengada),
        pagada: round2(totales.pagada),
        pendiente: round2(totales.pendiente),
      },
    })
  } catch (error) {
    console.error("Error fetching comisiones:", error)
    return NextResponse.json(
      { error: "Error al obtener comisiones" },
      { status: 500 }
    )
  }
}
