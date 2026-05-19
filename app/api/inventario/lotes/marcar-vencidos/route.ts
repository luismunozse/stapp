import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// POST /api/inventario/lotes/marcar-vencidos
// Trigger manual de la RPC marcar_lotes_vencidos. Para ejecutar como job
// scheduled, llamar a la RPC desde un cron externo. Devuelve count.
export async function POST() {
  try {
    const { error } = await requireAdmin()
    if (error) return error

    const { data, error: rpcErr } = await supabaseAdmin.rpc("marcar_lotes_vencidos")
    if (rpcErr) throw rpcErr

    return NextResponse.json({ count: Number(data ?? 0) })
  } catch (err) {
    console.error("Error marcar vencidos:", err)
    return NextResponse.json({ error: "Error al marcar lotes vencidos" }, { status: 500 })
  }
}
