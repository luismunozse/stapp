import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { buildOrganizationExportStream } from "@/lib/account-deletion/export-organization"

// El respaldo puede tardar: los PDFs se bajan del proveedor. Ver también la
// entrada de esta ruta en vercel.json (el glob de app/api/** limita a 30 s).
export const maxDuration = 60
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// El slug va dentro de un header: solo ASCII seguro (sin comillas, CRLF ni separadores de path).
function safeFilenamePart(slug: string): string {
  const clean = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  return clean || "taller"
}

// GET /api/account/export — ZIP con la información fiscal y comercial del taller,
// para descargar ANTES de confirmar la eliminación. Solo ADMIN.
// Si una lectura falla a mitad del stream, la descarga se corta (ZIP truncado):
// es deliberado, no se bufferea el ZIP entero.
export async function GET() {
  const { error, userId, organizationId, session } = await requireAdmin()
  if (error) return error

  // El respaldo completo de un taller no se entrega a superadmin ni a sesiones
  // impersonadas (la impersonación es de solo lectura, pero esto es una fuga de datos).
  if (session!.user.isImpersonating || session!.user.isSuperadmin) {
    return NextResponse.json({ error: "Acción no permitida en esta sesión" }, { status: 403 })
  }

  // El taller sale SIEMPRE de la sesión.
  const { data: org, error: orgError } = await supabaseAdmin
    .from("organizations")
    .select("id, nombre, slug")
    .eq("id", organizationId!)
    .single()
  if (orgError || !org) return NextResponse.json({ error: "Taller no encontrado" }, { status: 404 })

  // Auditoría (quién y cuándo, sin datos): best-effort, no bloquea la descarga.
  try {
    const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
      organization_id: org.id,
      user_id: userId,
      action: "EXPORT",
      entity: "organizations",
      entity_id: org.id,
      changes: { requested_by: session!.user.email ?? null },
    })
    if (auditError) console.error("[account/export] audit_logs:", auditError)
  } catch (err) {
    console.error("[account/export] audit_logs:", err)
  }

  const fecha = new Date().toISOString().slice(0, 10)
  return new Response(buildOrganizationExportStream({ id: org.id, nombre: org.nombre, slug: org.slug }), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="respaldo-${safeFilenamePart(String(org.slug))}-${fecha}.zip"`,
      "Cache-Control": "no-store",
    },
  })
}
