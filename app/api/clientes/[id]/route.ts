import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const clienteSchema = z.object({
  nombre: z.string().min(1).optional(),
  telefono: z.string().min(1).optional(),
  email: z.string().email().optional().or(z.literal("")),
  direccion: z.string().optional(),
  dni: z.string().optional(),
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
    const cliente = await prisma.cliente.findUnique({
      where: { id },
      include: {
        ordenes: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    })

    if (!cliente) {
      return NextResponse.json(
        { error: "Cliente no encontrado" },
        { status: 404 }
      )
    }

    return NextResponse.json(cliente)
  } catch (error) {
    console.error("Error fetching cliente:", error)
    return NextResponse.json(
      { error: "Error al obtener cliente" },
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
    const data = clienteSchema.parse(body)

    const cliente = await prisma.cliente.update({
      where: { id },
      data: {
        ...data,
        email: data.email === "" ? null : data.email,
      },
    })

    return NextResponse.json(cliente)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating cliente:", error)
    return NextResponse.json(
      { error: "Error al actualizar cliente" },
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
    await prisma.cliente.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting cliente:", error)
    return NextResponse.json(
      { error: "Error al eliminar cliente" },
      { status: 500 }
    )
  }
}

