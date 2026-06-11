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
    const prefijo = catPrefijo

    // Use SQL function for efficient next-code generation (skips archived items)
    const { data, error: rpcError } = await supabaseAdmin
      .rpc("get_next_inventory_code", {
        p_org_id: organizationId!,
        p_prefix: prefijo,
      })

    if (rpcError) {
      throw rpcError
    }

    return NextResponse.json({ codigo: data })
  } catch (error) {
    console.error("Error generating next code:", error)
    return NextResponse.json(
      { error: "Error al generar código" },
      { status: 500 }
    )
  }
}
