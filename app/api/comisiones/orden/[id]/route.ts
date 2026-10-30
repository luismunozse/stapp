import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { readDocumentCommissionRows } from "@/lib/commissions/rows"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    // The definition (DB view) owns the numbers; this route only names the beneficiaries.
    const rows = await readDocumentCommissionRows(organizationId!, "ORDEN", id)

    const ids = Array.from(new Set(rows.map((r) => r.beneficiarioId).filter(Boolean)))
    const nombres = new Map<string, string>()
    if (ids.length > 0) {
      const { data: users } = await supabaseAdmin
        .from("users")
        .select("id, nombre")
        .in("id", ids)
        .eq("organization_id", organizationId!)
      ;(users || []).forEach((u) => nombres.set(u.id, u.nombre))
    }

    const filas = rows.map((r) => ({ ...r, beneficiarioNombre: nombres.get(r.beneficiarioId) || "—" }))
    return NextResponse.json({ filas }, { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    console.error("Error fetching order commission rows:", err)
    return NextResponse.json({ error: "Error al obtener la comisión de la orden" }, { status: 500 })
  }
}
