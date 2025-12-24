import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { calculateIVA, calculateTotal } from "@/lib/utils"

const generarFacturaSchema = z.object({
  ordenId: z.string().min(1, "La orden es requerida"),
})

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const body = await request.json()
    const { ordenId } = generarFacturaSchema.parse(body)

    // Verificar que la orden existe y está completada
    const orden = await prisma.ordenServicio.findUnique({
      where: { id: ordenId },
      include: {
        repuestos: {
          include: {
            inventario: true,
          },
        },
      },
    })

    if (!orden) {
      return NextResponse.json(
        { error: "Orden no encontrada" },
        { status: 404 }
      )
    }

    if (orden.estado !== "COMPLETADO") {
      return NextResponse.json(
        { error: "La orden debe estar completada para generar factura" },
        { status: 400 }
      )
    }

    // Verificar si ya existe una factura
    const facturaExistente = await prisma.factura.findUnique({
      where: { ordenId },
    })

    if (facturaExistente) {
      return NextResponse.json(
        { error: "Ya existe una factura para esta orden" },
        { status: 400 }
      )
    }

    // Calcular subtotal (costo final o suma de repuestos)
    let subtotal = orden.costoFinal || 0
    if (!subtotal && orden.repuestos.length > 0) {
      subtotal = orden.repuestos.reduce(
        (sum, r) => sum + r.cantidad * r.precioUnitario,
        0
      )
    }
    if (!subtotal && orden.presupuesto) {
      subtotal = orden.presupuesto
    }

    const iva = calculateIVA(subtotal)
    const total = calculateTotal(subtotal)

    // Obtener último número de factura
    const ultimaFactura = await prisma.factura.findFirst({
      orderBy: { numeroFactura: "desc" },
    })

    let numeroFactura = "0001-00000001"
    if (ultimaFactura) {
      const [punto, numero] = ultimaFactura.numeroFactura.split("-")
      const nuevoNumero = String(parseInt(numero) + 1).padStart(8, "0")
      numeroFactura = `${punto}-${nuevoNumero}`
    }

    const factura = await prisma.factura.create({
      data: {
        ordenId,
        numeroFactura,
        subtotal,
        iva,
        total,
        estadoPago: "PENDIENTE",
      },
      include: {
        orden: {
          include: {
            cliente: true,
          },
        },
      },
    })

    return NextResponse.json(factura, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error generating factura:", error)
    return NextResponse.json(
      { error: "Error al generar factura" },
      { status: 500 }
    )
  }
}

