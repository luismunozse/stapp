import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid("ID inválido")).min(1, "Debe seleccionar al menos un registro"),
})

export async function POST(request: Request) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const parsed = await safeParseBody(request, bulkDeleteSchema)
    if ("error" in parsed) return parsed.error

    const { ids } = parsed.data

    const { data, error: dbError } = await supabaseAdmin
      .from("ios_waitlist")
      .delete()
      .in("id", ids)
      .select("id")

    if (dbError) throw dbError

    const count = data?.length ?? 0

    const auditLogger = createSuperadminAuditLogger(email, request)
    auditLogger.waitlistBulkDelete(count, ids).catch(() => {})

    return NextResponse.json({ success: true, count })
  } catch (error) {
    console.error("Error bulk deleting waitlist entries:", error)
    return NextResponse.json(
      { error: "Error al eliminar registros en lote" },
      { status: 500 }
    )
  }
}
