import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// Lectura pública (cualquier rol autenticado) de feature flags por org.
// Se usa desde el sidebar/nav para mostrar/ocultar módulos opcionales.
export async function GET() {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { data } = await supabaseAdmin
      .from("organizations")
      .select("modulo_agenda, vendedores_administran_inventario")
      .eq("id", organizationId!)
      .single()

    return NextResponse.json(
      {
        moduloAgenda: !!data?.modulo_agenda,
        vendedoresAdministranInventario: !!data?.vendedores_administran_inventario,
      },
      {
        headers: {
          "Cache-Control": "private, max-age=60",
        },
      },
    )
  } catch (err) {
    console.error("Error fetching org features:", err)
    return NextResponse.json(
      { moduloAgenda: false, vendedoresAdministranInventario: false },
      { status: 200 },
    )
  }
}
