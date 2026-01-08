import { NextResponse } from "next/server"
import { generateCSVTemplate } from "@/lib/csv-parser"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ entity: string }> }
) {
  try {
    const { entity } = await params

    if (entity !== 'CLIENTES' && entity !== 'INVENTARIO') {
      return NextResponse.json(
        { error: "Tipo de entidad inválido" },
        { status: 400 }
      )
    }

    const csvContent = generateCSVTemplate(entity as 'CLIENTES' | 'INVENTARIO')

    const filename = entity === 'CLIENTES'
      ? 'plantilla_clientes.csv'
      : 'plantilla_inventario.csv'

    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error("Error generating template:", error)
    return NextResponse.json(
      { error: "Error al generar plantilla" },
      { status: 500 }
    )
  }
}
