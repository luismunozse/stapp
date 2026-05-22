import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { requireCronAuth } from "@/lib/cron-auth"

export const maxDuration = 60

export async function GET(request: Request) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  try {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const fechaStr = yesterday.toISOString().split("T")[0]
    const yesterdayStart = new Date(fechaStr + "T00:00:00Z")
    const yesterdayEnd = new Date(fechaStr + "T23:59:59Z")

    const { data: orgs } = await supabaseAdmin
      .from("organizations")
      .select("id")
      .eq("activo", true)
      .neq("slug", "superadmin")

    let processed = 0

    for (const org of orgs || []) {
      const [ordenesRes, completadasRes, ventasRes, clientesRes] = await Promise.all([
        supabaseAdmin.from("ordenes_servicio").select("id", { count: "exact", head: true })
          .eq("organization_id", org.id).gte("created_at", yesterdayStart.toISOString()).lte("created_at", yesterdayEnd.toISOString()),
        supabaseAdmin.from("ordenes_servicio").select("id", { count: "exact", head: true })
          .eq("organization_id", org.id).eq("estado", "ENTREGADO").gte("updated_at", yesterdayStart.toISOString()).lte("updated_at", yesterdayEnd.toISOString()),
        supabaseAdmin.from("ventas").select("id", { count: "exact", head: true })
          .eq("organization_id", org.id).gte("created_at", yesterdayStart.toISOString()).lte("created_at", yesterdayEnd.toISOString()),
        supabaseAdmin.from("clientes").select("id", { count: "exact", head: true })
          .eq("organization_id", org.id).gte("created_at", yesterdayStart.toISOString()).lte("created_at", yesterdayEnd.toISOString()),
      ])

      const ordenes = ordenesRes.count || 0
      const completadas = completadasRes.count || 0
      const ventas = ventasRes.count || 0
      const clientes = clientesRes.count || 0
      const loginCount = Math.max(ordenes, ventas) > 0 ? 1 : 0

      const score = Math.min(100,
        Math.min(loginCount * 10, 30) +
        Math.min(ordenes * 5, 25) +
        Math.min(completadas * 5, 20) +
        Math.min(ventas * 5, 15) +
        Math.min(clientes * 5, 10)
      )

      await supabaseAdmin.from("organization_engagement").upsert({
        organization_id: org.id,
        fecha: fechaStr,
        ordenes_creadas: ordenes,
        ordenes_completadas: completadas,
        ventas_realizadas: ventas,
        clientes_nuevos: clientes,
        usuarios_activos: loginCount,
        login_count: loginCount,
        engagement_score: score,
      }, { onConflict: "organization_id,fecha" })

      processed++
    }

    return NextResponse.json({ success: true, processed, fecha: fechaStr, timestamp: new Date().toISOString() })
  } catch (error) {
    console.error("Error en cron engagement:", error)
    return NextResponse.json({ error: "Error calculando engagement" }, { status: 500 })
  }
}
