import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin, STORAGE_BUCKETS } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import type { OrganizationDetailResponse, PaymentWithOrg } from "@/types/superadmin"

/**
 * Calcula el storage real (en MB) de una organización sumando el tamaño
 * de todos los archivos en los buckets donde se guardan assets por orgId.
 * Los buckets usan la convención {orgId}/... como path prefix.
 */
async function calculateRealStorageMb(orgId: string): Promise<number> {
  const bucketsToCheck = [
    STORAGE_BUCKETS.FOTOS_ORDENES,
    STORAGE_BUCKETS.FOTOS_INVENTARIO,
    STORAGE_BUCKETS.LOGOS,
    STORAGE_BUCKETS.FIRMAS,
    STORAGE_BUCKETS.AVATARS,
    STORAGE_BUCKETS.COMPROBANTES_GASTOS,
  ]

  let totalBytes = 0

  const results = await Promise.all(
    bucketsToCheck.map(async (bucket) => {
      try {
        const { data: files } = await supabaseAdmin.storage
          .from(bucket)
          .list(orgId, { limit: 1000 })
        if (!files) return 0

        let bucketBytes = 0
        for (const file of files) {
          if (file.metadata?.size) {
            bucketBytes += file.metadata.size
          }
        }

        // Para buckets con subdirectorios (fotos-ordenes, firmas),
        // listar primer nivel devuelve carpetas. Necesitamos recorrerlas.
        const subfolders = files.filter(
          (f) => !f.metadata?.size && f.id === null
        )
        for (const folder of subfolders) {
          const { data: subFiles } = await supabaseAdmin.storage
            .from(bucket)
            .list(`${orgId}/${folder.name}`, { limit: 1000 })
          if (subFiles) {
            for (const sf of subFiles) {
              if (sf.metadata?.size) {
                bucketBytes += sf.metadata.size
              }
            }
          }
        }

        return bucketBytes
      } catch {
        return 0
      }
    })
  )

  totalBytes = results.reduce((sum, b) => sum + b, 0)
  return totalBytes / (1024 * 1024)
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { id } = await params

    const [orgResult, usersResult, usageResult, subscriptionResult] =
      await Promise.all([
        // Organización
        supabaseAdmin
          .from("organizations")
          .select("*")
          .eq("id", id)
          .single(),

        // Usuarios
        supabaseAdmin
          .from("users")
          .select("id, nombre, email, rol, email_verified, created_at")
          .eq("organization_id", id)
          .order("created_at", { ascending: false }),

        // Uso
        supabaseAdmin
          .from("organization_usage")
          .select("*")
          .eq("organization_id", id)
          .single(),

        // Suscripción con plan
        supabaseAdmin
          .from("subscriptions")
          .select(
            `
            *,
            plans (*)
          `
          )
          .eq("organization_id", id)
          .single(),
      ])

    if (orgResult.error || !orgResult.data) {
      return NextResponse.json(
        { error: "Organización no encontrada" },
        { status: 404 }
      )
    }

    // Obtener pagos, storage real y órdenes históricas en paralelo
    let payments: PaymentWithOrg[] = []
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

    const [paymentsResult, realStorageMb, ordersResult] = await Promise.all([
      subscriptionResult.data?.id
        ? supabaseAdmin
            .from("subscription_payments")
            .select("*")
            .eq("subscription_id", subscriptionResult.data.id)
            .order("paid_at", { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [] }),
      calculateRealStorageMb(id),
      supabaseAdmin
        .from("ordenes_servicio")
        .select("fecha_ingreso")
        .eq("organization_id", id)
        .gte("fecha_ingreso", sixMonthsAgo.toISOString())
        .order("fecha_ingreso", { ascending: true }),
    ])

    payments = paymentsResult.data || []

    // Agrupar órdenes por mes
    const monthCounts: Record<string, number> = {}
    // Inicializar los 6 meses para que no haya gaps
    for (let i = 5; i >= 0; i--) {
      const d = new Date()
      d.setMonth(d.getMonth() - i)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      monthCounts[key] = 0
    }
    for (const order of ordersResult.data || []) {
      const d = new Date(order.fecha_ingreso)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      if (key in monthCounts) monthCounts[key]++
    }
    const ordersHistory = Object.entries(monthCounts).map(([month, count]) => ({
      month,
      count,
    }))

    // Sobreescribir storage_used_mb con el cálculo real desde los buckets
    const usageData = usageResult.data
      ? { ...usageResult.data, storage_used_mb: realStorageMb }
      : { organization_id: id, ordenes_count: 0, ordenes_mes_actual: 0, tecnicos_count: 0, vendedores_count: 0, clientes_count: 0, storage_used_mb: realStorageMb, periodo_inicio: new Date().toISOString() }

    const response: OrganizationDetailResponse = {
      organization: orgResult.data,
      users: usersResult.data || [],
      usage: usageData,
      subscription: subscriptionResult.data || null,
      payments,
      ordersHistory,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error("Error fetching organization detail:", error)
    return NextResponse.json(
      { error: "Error al obtener detalle de organización" },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/superadmin/organizations/[id]
 * Elimina una organización y todos sus datos (CASCADE en DB).
 * También limpia archivos de storage.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const { id } = await params

    // Verificar que la organización existe
    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select("id, nombre, slug")
      .eq("id", id)
      .single()

    if (orgError || !org) {
      return NextResponse.json(
        { error: "Organización no encontrada" },
        { status: 404 }
      )
    }

    // Guard: nunca borrar la org del panel admin
    if (org.slug === "superadmin") {
      return NextResponse.json(
        { error: "No se puede eliminar la organización del panel admin" },
        { status: 403 }
      )
    }

    // Limpiar archivos de storage (best effort, no bloquea el delete)
    const bucketsToClean = [
      STORAGE_BUCKETS.FOTOS_ORDENES,
      STORAGE_BUCKETS.FOTOS_INVENTARIO,
      STORAGE_BUCKETS.LOGOS,
      STORAGE_BUCKETS.FIRMAS,
      STORAGE_BUCKETS.AVATARS,
      STORAGE_BUCKETS.COMPROBANTES_GASTOS,
    ]

    await Promise.allSettled(
      bucketsToClean.map(async (bucket) => {
        try {
          const { data: files } = await supabaseAdmin.storage
            .from(bucket)
            .list(id, { limit: 1000 })
          if (files && files.length > 0) {
            const paths = files.map((f) => `${id}/${f.name}`)
            await supabaseAdmin.storage.from(bucket).remove(paths)
          }
        } catch {
          // Storage cleanup is best-effort
        }
      })
    )

    // Eliminar organización (CASCADE borra users, orders, subscriptions, etc.)
    const { error: deleteError } = await supabaseAdmin
      .from("organizations")
      .delete()
      .eq("id", id)

    if (deleteError) {
      console.error("Error deleting organization:", deleteError)
      return NextResponse.json(
        { error: "Error al eliminar la organización" },
        { status: 500 }
      )
    }

    // Registrar en audit_logs (la org ya no existe, log sin org_id)
    try {
      await supabaseAdmin.from("audit_logs").insert({
        organization_id: null,
        user_id: null,
        action: "DELETE",
        entity: "organizations",
        entity_id: id,
        changes: {
          deleted_org: { id, nombre: org.nombre, slug: org.slug },
          superadmin_email: email,
        },
      })
    } catch {
      // best effort
    }

    return NextResponse.json({
      success: true,
      message: `Organización "${org.nombre}" eliminada permanentemente`,
    })
  } catch (error) {
    console.error("Error in DELETE /api/superadmin/organizations/[id]:", error)
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}

const updateOrgSchema = z.object({
  nombre: z.string().min(1).optional(),
  nombre_mostrar: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  telefono: z.string().nullable().optional(),
  direccion: z.string().nullable().optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: "Se requiere al menos un campo para actualizar",
})

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const { id } = await params
    const parsed = await safeParseBody(request, updateOrgSchema)
    if ("error" in parsed) return parsed.error
    const updateData = parsed.data

    const { data, error: dbError } = await supabaseAdmin
      .from("organizations")
      .update(updateData)
      .eq("id", id)
      .select()
      .single()

    if (dbError) throw dbError

    // Registrar en audit_logs
    await supabaseAdmin.from("audit_logs").insert({
      organization_id: id,
      user_id: null,
      action: "UPDATE",
      entity: "organizations",
      entity_id: id,
      changes: {
        updated_fields: Object.keys(updateData),
        superadmin_email: email,
      },
    })

    return NextResponse.json(data)
  } catch (error) {
    console.error("Error updating organization:", error)
    return NextResponse.json(
      { error: "Error al actualizar organización" },
      { status: 500 }
    )
  }
}
