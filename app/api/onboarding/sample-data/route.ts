import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { generateSampleData, cleanSampleData } from "@/lib/onboarding/sample-data"

export async function POST() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const result = await generateSampleData(organizationId!)

    return NextResponse.json({
      message: "Datos de ejemplo cargados exitosamente",
      counts: {
        clientes: result.clientes.length,
        ordenes: result.ordenes.length,
        inventario: result.inventario.length,
      },
    })
  } catch (err) {
    console.error("Error generating sample data:", err)
    return NextResponse.json({ error: "Error al generar datos de ejemplo" }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    await cleanSampleData(organizationId!)

    return NextResponse.json({ message: "Datos de ejemplo eliminados exitosamente" })
  } catch (err) {
    console.error("Error cleaning sample data:", err)
    return NextResponse.json({ error: "Error al eliminar datos de ejemplo" }, { status: 500 })
  }
}
