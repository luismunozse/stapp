import { NextResponse } from "next/server"
import { z } from "zod"
import { requireInventarioAccess } from "@/lib/auth-utils"
import { getSheetPreviews } from "@/lib/precios-import"

const schema = z.object({
  file: z.string().min(1),
  mime: z.string().optional(),
})

const MAX_BASE64_BYTES = 8 * 1024 * 1024 // ~6MB binary

export async function POST(request: Request) {
  try {
    const { error } = await requireInventarioAccess()
    if (error) return error

    const body = await request.json()
    const { file } = schema.parse(body)

    if (file.length > MAX_BASE64_BYTES) {
      return NextResponse.json(
        { error: "Archivo demasiado grande (máx 6MB)" },
        { status: 413 }
      )
    }

    const sheets = await getSheetPreviews(file, 30)
    if (sheets.length === 0) {
      return NextResponse.json({ error: "El archivo no contiene hojas" }, { status: 400 })
    }
    return NextResponse.json({ sheets })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error parsing price list:", err)
    return NextResponse.json(
      { error: "No se pudo leer el archivo. Asegurate de que sea un Excel válido (.xlsx)" },
      { status: 400 }
    )
  }
}
