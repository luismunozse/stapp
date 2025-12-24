import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const repuestoSchema = z.object({
  inventarioId: z.string().min(1),
  cantidad: z.number().int().min(1),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const data = repuestoSchema.parse(body)

    // Verificar que el item existe y tiene stock
    const item = await prisma.inventario.findUnique({
      where: { id: data.inventarioId },
    })

    if (!item) {
      return NextResponse.json(
        { error: "Item no encontrado" },
        { status: 404 }
      )
    }

    if (item.stock < data.cantidad) {
      return NextResponse.json(
        { error: "Stock insuficiente" },
        { status: 400 }
      )
    }

    // Crear relación y actualizar stock
    await prisma.$transaction([
      prisma.repuestoOrden.create({
        data: {
          ordenId: id,
          inventarioId: data.inventarioId,
          cantidad: data.cantidad,
          precioUnitario: item.precioVenta,
        },
      }),
      prisma.inventario.update({
        where: { id: data.inventarioId },
        data: {
          stock: {
            decrement: data.cantidad,
          },
        },
      }),
    ])

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error adding repuesto:", error)
    return NextResponse.json(
      { error: "Error al agregar repuesto" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const repuestoId = searchParams.get("repuestoId")

    if (!repuestoId) {
      return NextResponse.json(
        { error: "ID de repuesto requerido" },
        { status: 400 }
      )
    }

    const repuesto = await prisma.repuestoOrden.findUnique({
      where: { id: repuestoId },
      include: { inventario: true },
    })

    if (!repuesto || repuesto.ordenId !== id) {
      return NextResponse.json(
        { error: "Repuesto no encontrado" },
        { status: 404 }
      )
    }

    // Eliminar y devolver stock
    await prisma.$transaction([
      prisma.repuestoOrden.delete({
        where: { id: repuestoId },
      }),
      prisma.inventario.update({
        where: { id: repuesto.inventarioId },
        data: {
          stock: {
            increment: repuesto.cantidad,
          },
        },
      }),
    ])

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error removing repuesto:", error)
    return NextResponse.json(
      { error: "Error al eliminar repuesto" },
      { status: 500 }
    )
  }
}

