import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// Prefijos para categorías
const CATEGORIA_PREFIJOS: Record<string, string> = {
  "Baterías": "BAT",
  "Pantallas": "PAN",
  "Protectores": "PRO",
  "Fundas": "FUN",
  "Cargadores": "CAR",
  "Flex": "FLX",
  "Módulos": "MOD",
  "Teclados": "TEC",
  "Memorias": "MEM",
  "Discos": "DIS",
  "Joysticks": "JOY",
  "Fuentes": "FUE",
  "Lectoras": "LEC",
  "Coolers": "COO",
  "Mallas": "MAL",
  "Auriculares": "AUR",
  "Parlantes": "PAR",
  "Cables": "CAB",
  "Adaptadores": "ADP",
  "Soportes": "SOP",
  "Otros": "OTR",
}

// Prefijos para tipos de dispositivo
const TIPO_PREFIJOS: Record<string, string> = {
  "CELULAR": "CEL",
  "COMPUTADORA": "COM",
  "TABLET": "TAB",
  "CONSOLA": "CON",
  "SMARTWATCH": "SMA",
  "ACCESORIOS": "ACC",
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

    // Buscar TODOS los códigos con este prefijo para encontrar el número más alto
    const { data: items, error: dbError } = await supabaseAdmin
      .from("inventario")
      .select("codigo")
      .eq("organization_id", organizationId!)
      .ilike("codigo", `${prefijo}%`)

    if (dbError) {
      throw dbError
    }

    let maxNumber = 0

    if (items && items.length > 0) {
      for (const item of items) {
        const match = item.codigo.match(/-(\d+)$/)
        if (match) {
          const num = parseInt(match[1], 10)
          if (num > maxNumber) maxNumber = num
        }
      }
    }

    // Formatear con ceros a la izquierda (3 dígitos)
    const codigo = `${prefijo}${(maxNumber + 1).toString().padStart(3, "0")}`

    return NextResponse.json({ codigo })
  } catch (error) {
    console.error("Error generating next code:", error)
    return NextResponse.json(
      { error: "Error al generar código" },
      { status: 500 }
    )
  }
}
