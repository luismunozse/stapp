import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"

// Archivado masivo (soft delete). El borrado definitivo NO se hace en masa:
// es de a una organización desde DELETE /organizations/[id]?hard=true, que pide
// el slug exacto y pasa por purgeOrganization (cancela el cobro en el
// proveedor y vacía el storage). Antes este endpoint aceptaba `hard + confirm`
// y hacía un DELETE crudo: sin cancelar la suscripción (el taller se seguía
// cobrando) y dejando el storage huérfano. La UI nunca lo usó.
const MAX_ORGS_POR_LOTE = 100

const bulkDeleteSchema = z.object({
  ids: z
    // Los ids de organizations son cuid (TEXT), no UUID.
    .array(z.string().trim().min(1, "ID de organización inválido").max(64, "ID de organización inválido"))
    .min(1, "Debe seleccionar al menos una organización")
    .max(MAX_ORGS_POR_LOTE, `Máximo ${MAX_ORGS_POR_LOTE} organizaciones por vez`),
  hard: z.boolean().optional(),
})

export async function POST(request: Request) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const parsed = await safeParseBody(request, bulkDeleteSchema)
    if ("error" in parsed) return parsed.error

    const { ids, hard } = parsed.data

    if (hard === true) {
      return NextResponse.json(
        {
          error:
            "El borrado definitivo es de a una organización, desde su detalle (pide el slug y cancela el cobro). Acá solo se archiva.",
        },
        { status: 400 }
      )
    }

    // Obtener nombres + slug para guard + log
    const { data: orgs } = await supabaseAdmin
      .from("organizations")
      .select("id, nombre, slug")
      .in("id", ids)

    // Guard: filtrar la org del panel admin del set a procesar
    const protectedIds = (orgs || [])
      .filter((o) => o.slug === "superadmin")
      .map((o) => o.id)
    const targetIds = ids.filter((id) => !protectedIds.includes(id))

    if (targetIds.length === 0) {
      return NextResponse.json(
        { error: "Ninguna organización válida para eliminar (la del panel admin está protegida)" },
        { status: 400 }
      )
    }

    // Default path — archive (soft delete)
    const { count: archivedCount, error: archiveError } = await supabaseAdmin
      .from("organizations")
      .update({ deleted_at: new Date().toISOString(), deleted_by: email }, { count: "exact" })
      .in("id", targetIds)
      .neq("slug", "superadmin")
      .is("deleted_at", null)

    if (archiveError) {
      console.error("Bulk archive error:", archiveError)
      return NextResponse.json(
        { error: "Error al archivar organizaciones" },
        { status: 500 }
      )
    }

    const archived = archivedCount ?? 0

    // Audit log — best effort
    try {
      await supabaseAdmin.from("audit_logs").insert({
        organization_id: null,
        user_id: null,
        action: "ARCHIVE",
        entity: "organizations",
        entity_id: null,
        changes: {
          archived_count: archived,
          archived_orgs: orgs
            ?.filter((o) => targetIds.includes(o.id))
            .map((o) => ({ id: o.id, nombre: o.nombre })),
          superadmin_email: email,
        },
      })
    } catch {
      // best effort
    }

    return NextResponse.json({
      success: true,
      archived,
      deleted: archived,
      message: `${archived} organización(es) archivada(s)`,
    })
  } catch (error) {
    console.error("Error in bulk delete:", error)
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}
