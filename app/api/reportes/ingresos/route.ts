import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const desde = searchParams.get("desde")
    const hasta = searchParams.get("hasta")

    const where: any = {
      estadoPago: "PAGADO",
    }

    if (desde && hasta) {
      where.fecha = {
        gte: new Date(desde),
        lte: new Date(hasta),
      }
    } else {
      // Últimos 30 días por defecto
      const fechaDesde = new Date()
      fechaDesde.setDate(fechaDesde.getDate() - 30)
      where.fecha = {
        gte: fechaDesde,
      }
    }

    const facturas = await prisma.factura.findMany({
      where,
      include: {
        orden: {
          include: {
            cliente: true,
          },
        },
      },
      orderBy: { fecha: "asc" },
    })

    const total = facturas.reduce((sum, f) => sum + f.total, 0)
    const totalIva = facturas.reduce((sum, f) => sum + f.iva, 0)
    const totalSubtotal = facturas.reduce((sum, f) => sum + f.subtotal, 0)

    return NextResponse.json({
      facturas,
      resumen: {
        total,
        totalIva,
        totalSubtotal,
        cantidad: facturas.length,
      },
    })
  } catch (error) {
    console.error("Error fetching ingresos:", error)
    return NextResponse.json(
      { error: "Error al obtener ingresos" },
      { status: 500 }
    )
  }
}

