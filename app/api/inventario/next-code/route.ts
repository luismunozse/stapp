import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// Prefijos para categorías
const CATEGORIA_PREFIJOS: Record<string, string> = {
  "Baterías": "BAT",
  "Pantallas": "PAN",
  "Carcasas": "CAR",
  "Teclados": "TEC",
  "Memoria": "MEM",
  "Procesadores": "PRO",
  "Otros": "OTR",
}

// Prefijos para tipos de dispositivo
const TIPO_PREFIJOS: Record<string, string> = {
  "CELULAR": "CEL",
  "COMPUTADORA": "COM",
  "TABLET": "TAB",
  "CONSOLA": "CON",
  "SMARTWATCH": "SMA",
  "TODOS": "GEN",
}

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const categoria = searchParams.get("categoria") || ""
    const tipoDispositivo = searchParams.get("tipoDispositivo") || ""

    // Si no hay categoría o tipo, devolver vacío
    if (!categoria || !tipoDispositivo) {
      return NextResponse.json({ codigo: "" })
    }

    const catPrefijo = CATEGORIA_PREFIJOS[categoria] || categoria.substring(0, 3).toUpperCase()
    const tipoPrefijo = TIPO_PREFIJOS[tipoDispositivo] || tipoDispositivo.substring(0, 3).toUpperCase()
    const prefijo = `${catPrefijo}-${tipoPrefijo}-`

    // Buscar el último código con este prefijo
    const { data: items, error: dbError } = await supabaseAdmin
      .from("inventario")
      .select("codigo")
      .eq("organization_id", organizationId!)
      .ilike("codigo", `${prefijo}%`)
      .order("codigo", { ascending: false })
      .limit(1)

    if (dbError) {
      throw dbError
    }

    let nextNumber = 1

    if (items && items.length > 0) {
      // Extraer el número del último código
      const lastCode = items[0].codigo
      const match = lastCode.match(/-(\d+)$/)
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1
      }
    }

    // Formatear con ceros a la izquierda (3 dígitos)
    const codigo = `${prefijo}${nextNumber.toString().padStart(3, "0")}`

    return NextResponse.json({ codigo })
  } catch (error) {
    console.error("Error generating next code:", error)
    return NextResponse.json(
      { error: "Error al generar código" },
      { status: 500 }
    )
  }
}
