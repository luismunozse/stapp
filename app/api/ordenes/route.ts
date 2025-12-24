import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const ordenSchema = z.object({
  clienteId: z.string().min(1, "El cliente es requerido"),
  dispositivo: z.string().min(1, "El dispositivo es requerido"),
  tipoDispositivo: z.enum(["CELULAR", "COMPUTADORA"]),
  problemaReportado: z.string().min(1, "El problema es requerido"),
  presupuesto: z.number().optional(),
  fechaPrometida: z.string().optional(),
  observaciones: z.string().optional(),
})

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const estado = searchParams.get("estado") || ""
    const tecnicoId = searchParams.get("tecnicoId") || ""
    const search = searchParams.get("search") || ""

    const where: any = {}

    // Técnicos solo ven sus órdenes asignadas
    if (session.user.role === "TECNICO") {
      where.tecnicoId = session.user.id
    }

    if (estado) {
      where.estado = estado
    }

    if (tecnicoId) {
      where.tecnicoId = tecnicoId
    }

    if (search) {
      where.OR = [
        { numeroOrden: { toString: { contains: search } } },
        { dispositivo: { contains: search, mode: "insensitive" } },
        { cliente: { nombre: { contains: search, mode: "insensitive" } } },
      ]
    }

    const ordenes = await prisma.ordenServicio.findMany({
      where,
      include: {
        cliente: true,
        tecnico: {
          select: {
            id: true,
            nombre: true,
          },
        },
      },
      orderBy: { fechaIngreso: "desc" },
    })

    return NextResponse.json(ordenes)
  } catch (error) {
    console.error("Error fetching ordenes:", error)
    return NextResponse.json(
      { error: "Error al obtener órdenes" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const body = await request.json()
    const data = ordenSchema.parse(body)

    // Obtener el último número de orden para incrementarlo manualmente
    const ultimaOrden = await prisma.ordenServicio.findFirst({
      orderBy: { numeroOrden: "desc" },
      select: { numeroOrden: true },
    })

    const siguienteNumero = ultimaOrden ? ultimaOrden.numeroOrden + 1 : 1

    const orden = await prisma.ordenServicio.create({
      data: {
        ...data,
        numeroOrden: siguienteNumero,
        fechaPrometida: data.fechaPrometida
          ? new Date(data.fechaPrometida)
          : null,
        presupuesto: data.presupuesto || null,
        observaciones: data.observaciones || null,
      },
      include: {
        cliente: true,
      },
    })

    return NextResponse.json(orden, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating orden:", error)
    return NextResponse.json(
      { error: "Error al crear orden" },
      { status: 500 }
    )
  }
}

