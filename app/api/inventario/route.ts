import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const inventarioSchema = z.object({
  codigo: z.string().min(1, "El código es requerido"),
  nombre: z.string().min(1, "El nombre es requerido"),
  descripcion: z.string().optional(),
  categoria: z.string().min(1, "La categoría es requerida"),
  tipoDispositivo: z.enum(["CELULAR", "COMPUTADORA"]),
  stock: z.number().int().min(0),
  precioCompra: z.number().min(0),
  precioVenta: z.number().min(0),
  proveedor: z.string().optional(),
})

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search") || ""
    const categoria = searchParams.get("categoria") || ""
    const tipoDispositivo = searchParams.get("tipoDispositivo") || ""

    const where: any = {}

    if (search) {
      where.OR = [
        { nombre: { contains: search, mode: "insensitive" } },
        { codigo: { contains: search, mode: "insensitive" } },
      ]
    }

    if (categoria) {
      where.categoria = categoria
    }

    if (tipoDispositivo) {
      where.tipoDispositivo = tipoDispositivo
    }

    const inventario = await prisma.inventario.findMany({
      where,
      orderBy: { nombre: "asc" },
    })

    return NextResponse.json(inventario)
  } catch (error) {
    console.error("Error fetching inventario:", error)
    return NextResponse.json(
      { error: "Error al obtener inventario" },
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
    const data = inventarioSchema.parse(body)

    const inventario = await prisma.inventario.create({
      data,
    })

    return NextResponse.json(inventario, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating inventario:", error)
    return NextResponse.json(
      { error: "Error al crear item de inventario" },
      { status: 500 }
    )
  }
}

