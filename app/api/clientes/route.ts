import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const clienteSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido"),
  telefono: z.string().min(1, "El teléfono es requerido"),
  email: z.string().email().optional().or(z.literal("")),
  direccion: z.string().optional(),
  dni: z.string().optional(),
})

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search") || ""

    const clientes = await prisma.cliente.findMany({
      where: search
        ? {
            OR: [
              { nombre: { contains: search, mode: "insensitive" } },
              { telefono: { contains: search, mode: "insensitive" } },
              { dni: { contains: search, mode: "insensitive" } },
            ],
          }
        : {},
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json(clientes)
  } catch (error) {
    console.error("Error fetching clientes:", error)
    return NextResponse.json(
      { error: "Error al obtener clientes" },
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
    const data = clienteSchema.parse(body)

    const cliente = await prisma.cliente.create({
      data: {
        ...data,
        email: data.email || null,
        direccion: data.direccion || null,
        dni: data.dni || null,
      },
    })

    return NextResponse.json(cliente, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating cliente:", error)
    return NextResponse.json(
      { error: "Error al crear cliente" },
      { status: 500 }
    )
  }
}

