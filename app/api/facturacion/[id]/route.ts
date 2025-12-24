import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const updateFacturaSchema = z.object({
  estadoPago: z.enum(["PENDIENTE", "PAGADO"]).optional(),
})

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
    const data = updateFacturaSchema.parse(body)

    const factura = await prisma.factura.update({
      where: { id },
      data,
      include: {
        orden: {
          include: {
            cliente: true,
          },
        },
      },
    })

    return NextResponse.json(factura)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating factura:", error)
    return NextResponse.json(
      { error: "Error al actualizar factura" },
      { status: 500 }
    )
  }
}

