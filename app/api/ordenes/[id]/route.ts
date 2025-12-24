import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const updateOrdenSchema = z.object({
  estado: z
    .enum([
      "PENDIENTE",
      "EN_REPARACION",
      "ESPERANDO_REPUESTO",
      "COMPLETADO",
      "ENTREGADO",
      "CANCELADO",
    ])
    .optional(),
  tecnicoId: z.string().optional().nullable(),
  presupuesto: z.number().optional().nullable(),
  costoFinal: z.number().optional().nullable(),
  fechaPrometida: z.string().optional().nullable(),
  observaciones: z.string().optional().nullable(),
  diagnostico: z.string().optional().nullable(),
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

    const orden = await prisma.ordenServicio.findUnique({
      where: { id },
      include: {
        cliente: true,
        tecnico: {
          select: {
            id: true,
            nombre: true,
            email: true,
          },
        },
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

    // Técnicos solo pueden ver sus órdenes asignadas
    if (
      session.user.role === "TECNICO" &&
      orden.tecnicoId !== session.user.id
    ) {
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 403 }
      )
    }

    return NextResponse.json(orden)
  } catch (error) {
    console.error("Error fetching orden:", error)
    return NextResponse.json(
      { error: "Error al obtener orden" },
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
    const data = updateOrdenSchema.parse(body)

    const orden = await prisma.ordenServicio.findUnique({
      where: { id },
    })

    if (!orden) {
      return NextResponse.json(
        { error: "Orden no encontrada" },
        { status: 404 }
      )
    }

    // Técnicos solo pueden actualizar sus órdenes asignadas
    if (
      session.user.role === "TECNICO" &&
      orden.tecnicoId !== session.user.id
    ) {
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 403 }
      )
    }

    const updateData: any = { ...data }

    if (data.fechaPrometida !== undefined) {
      updateData.fechaPrometida = data.fechaPrometida
        ? new Date(data.fechaPrometida)
        : null
    }

    if (data.estado === "COMPLETADO" && !orden.fechaCompletado) {
      updateData.fechaCompletado = new Date()
    }

    const updatedOrden = await prisma.ordenServicio.update({
      where: { id },
      data: updateData,
      include: {
        cliente: true,
        tecnico: {
          select: {
            id: true,
            nombre: true,
          },
        },
      },
    })

    return NextResponse.json(updatedOrden)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating orden:", error)
    return NextResponse.json(
      { error: "Error al actualizar orden" },
      { status: 500 }
    )
  }
}

