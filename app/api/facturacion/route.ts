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
    const estadoPago = searchParams.get("estadoPago") || ""

    const where: any = {}
    if (estadoPago) {
      where.estadoPago = estadoPago
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
      orderBy: { fecha: "desc" },
    })

    return NextResponse.json(facturas)
  } catch (error) {
    console.error("Error fetching facturas:", error)
    return NextResponse.json(
      { error: "Error al obtener facturas" },
      { status: 500 }
    )
  }
}

