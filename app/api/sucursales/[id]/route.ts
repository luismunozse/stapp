import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const updateSchema = z.object({
  nombre: z.string().trim().min(1).max(100).optional(),
  codigo: z.string().trim().max(40).nullable().optional(),
  direccion: z.string().trim().max(300).nullable().optional(),
  telefono: z.string().trim().max(40).nullable().optional(),
  notas: z.string().trim().max(500).nullable().optional(),
  principal: z.boolean().optional(),
  activo: z.boolean().optional(),
})

function formatSucursal(row: any) {
  return {
    id: row.id,
    nombre: row.nombre,
    codigo: row.codigo ?? null,
    direccion: row.direccion ?? null,
    telefono: row.telefono ?? null,
    notas: row.notas ?? null,
    principal: row.principal,
    activo: row.activo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = updateSchema.parse(body)

    // Verificar pertenencia + obtener estado actual (para validar transiciones)
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("sucursales")
      .select("id, principal, activo")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Sucursal no encontrada" }, { status: 404 })
    }

    // No permitir desactivar / despromover la principal sin promover otra primero
    if (existing.principal && data.principal === false) {
      return NextResponse.json(
        { error: "No podés despromover la principal. Marcá otra como principal primero." },
        { status: 400 }
      )
    }
    if (existing.principal && data.activo === false) {
      return NextResponse.json(
        { error: "No podés desactivar la sucursal principal." },
        { status: 400 }
      )
    }

    // Promote: demote la actual principal antes
    if (data.principal === true && !existing.principal) {
      await supabaseAdmin
        .from("sucursales")
        .update({ principal: false })
        .eq("organization_id", organizationId!)
        .eq("principal", true)
        .is("deleted_at", null)
    }

    const updateData: Record<string, any> = {}
    if (data.nombre !== undefined) updateData.nombre = data.nombre
    if (data.codigo !== undefined) updateData.codigo = data.codigo
    if (data.direccion !== undefined) updateData.direccion = data.direccion
    if (data.telefono !== undefined) updateData.telefono = data.telefono
    if (data.notas !== undefined) updateData.notas = data.notas
    if (data.principal !== undefined) updateData.principal = data.principal
    if (data.activo !== undefined) updateData.activo = data.activo

    const { data: row, error: updateErr } = await supabaseAdmin
      .from("sucursales")
      .update(updateData)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .select("*")
      .single()

    if (updateErr) {
      if ((updateErr as any).code === "23505") {
        return NextResponse.json(
          { error: "Ya existe una sucursal con ese nombre" },
          { status: 400 }
        )
      }
      throw updateErr
    }

    return NextResponse.json(formatSucursal(row))
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error updating sucursal:", err)
    return NextResponse.json({ error: "Error al actualizar sucursal" }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("sucursales")
      .select("id, principal")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Sucursal no encontrada" }, { status: 404 })
    }

    if (existing.principal) {
      return NextResponse.json(
        { error: "No se puede archivar la sucursal principal." },
        { status: 400 }
      )
    }

    // Bloquear archivado si la sucursal tiene órdenes o usuarios asignados.
    const [{ count: ordenesCount }, { count: usersCount }] = await Promise.all([
      supabaseAdmin
        .from("ordenes_servicio")
        .select("id", { count: "exact", head: true })
        .eq("sucursal_id", id),
      supabaseAdmin
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("sucursal_id", id),
    ])

    if ((ordenesCount ?? 0) > 0 || (usersCount ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            "La sucursal tiene órdenes o personal asignado. Reasigná antes de archivar, o desactivala.",
          code: "HAS_DATA",
        },
        { status: 409 }
      )
    }

    const { error: deleteErr } = await supabaseAdmin
      .from("sucursales")
      .update({ deleted_at: new Date().toISOString(), activo: false })
      .eq("id", id)
      .eq("organization_id", organizationId!)

    if (deleteErr) throw deleteErr

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Error deleting sucursal:", err)
    return NextResponse.json({ error: "Error al archivar sucursal" }, { status: 500 })
  }
}
