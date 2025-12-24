import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const tecnicos = await prisma.user.findMany({
      where: {
        rol: "TECNICO",
      },
      include: {
        ordenesAsignadas: {
          where: {
            estado: {
              in: ["PENDIENTE", "EN_REPARACION", "ESPERANDO_REPUESTO"],
            },
          },
        },
      },
      orderBy: { nombre: "asc" },
    })

    const tecnicosConStats = tecnicos.map((tecnico) => {
      const completadas = tecnico.ordenesAsignadas.filter(
        (o) => o.estado === "COMPLETADO" || o.estado === "ENTREGADO"
      ).length
      return {
        id: tecnico.id,
        nombre: tecnico.nombre,
        email: tecnico.email,
        ordenesActivas: tecnico.ordenesAsignadas.length,
        ordenesCompletadas: completadas,
      }
    })

    return NextResponse.json(tecnicosConStats)
  } catch (error) {
    console.error("Error fetching tecnicos:", error)
    return NextResponse.json(
      { error: "Error al obtener técnicos" },
      { status: 500 }
    )
  }
}

