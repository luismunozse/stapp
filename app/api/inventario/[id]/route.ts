import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const inventarioSchema = z.object({
  codigo: z.string().min(1).optional(),
  nombre: z.string().min(1).optional(),
  descripcion: z.string().optional(),
  categoria: z.string().min(1).optional(),
  tipoDispositivo: z.enum(["CELULAR", "COMPUTADORA"]).optional(),
  stock: z.number().int().min(0).optional(),
  precioCompra: z.number().min(0).optional(),
  precioVenta: z.number().min(0).optional(),
  proveedor: z.string().optional(),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const { id } = await params
    const item = await prisma.inventario.findUnique({
      where: { id },
    })

    if (!item) {
      return NextResponse.json(
        { error: "Item no encontrado" },
        { status: 404 }
      )
    }

    return NextResponse.json(item)
  } catch (error) {
    console.error("Error fetching inventario:", error)
    return NextResponse.json(
      { error: "Error al obtener item" },
      { status: 500 }
    )
  }
}

export async function PUT(
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
    const data = inventarioSchema.parse(body)

    const item = await prisma.inventario.update({
      where: { id },
      data,
    })

    return NextResponse.json(item)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating inventario:", error)
    return NextResponse.json(
      { error: "Error al actualizar item" },
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

    const { id } = await params
    await prisma.inventario.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting inventario:", error)
    return NextResponse.json(
      { error: "Error al eliminar item" },
      { status: 500 }
    )
  }
}

