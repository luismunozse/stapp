import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const updateSchema = z.object({
  nombre: z.string().trim().min(1).max(100).optional(),
  codigo: z.string().trim().max(40).nullable().optional(),
  direccion: z.string().trim().max(300).nullable().optional(),
  notas: z.string().trim().max(500).nullable().optional(),
  principal: z.boolean().optional(),
  activo: z.boolean().optional(),
})

function formatDeposito(row: any) {
  return {
    id: row.id,
    nombre: row.nombre,
    codigo: row.codigo ?? null,
    direccion: row.direccion ?? null,
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
      .from("depositos")
      .select("id, principal, activo")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Depósito no encontrado" }, { status: 404 })
    }

    // No permitir desactivar / despromover el principal sin promover otro primero
    if (existing.principal && data.principal === false) {
      return NextResponse.json(
        { error: "No podés despromover el principal. Marcá otro como principal primero." },
        { status: 400 }
      )
    }
    if (existing.principal && data.activo === false) {
      return NextResponse.json(
        { error: "No podés desactivar el depósito principal." },
        { status: 400 }
      )
    }

    // Promote: demote actual principal antes
    if (data.principal === true && !existing.principal) {
      await supabaseAdmin
        .from("depositos")
        .update({ principal: false })
        .eq("organization_id", organizationId!)
        .eq("principal", true)
        .is("deleted_at", null)
    }

    const updateData: Record<string, any> = {}
    if (data.nombre !== undefined) updateData.nombre = data.nombre
    if (data.codigo !== undefined) updateData.codigo = data.codigo
    if (data.direccion !== undefined) updateData.direccion = data.direccion
    if (data.notas !== undefined) updateData.notas = data.notas
    if (data.principal !== undefined) updateData.principal = data.principal
    if (data.activo !== undefined) updateData.activo = data.activo

    const { data: row, error: updateErr } = await supabaseAdmin
      .from("depositos")
      .update(updateData)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .select("*")
      .single()

    if (updateErr) {
      if ((updateErr as any).code === "23505") {
        return NextResponse.json(
          { error: "Ya existe un depósito con ese nombre" },
          { status: 400 }
        )
      }
      throw updateErr
    }

    return NextResponse.json(formatDeposito(row))
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error updating deposito:", err)
    return NextResponse.json({ error: "Error al actualizar depósito" }, { status: 500 })
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
      .from("depositos")
      .select("id, principal")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Depósito no encontrado" }, { status: 404 })
    }

    if (existing.principal) {
      return NextResponse.json(
        { error: "No se puede archivar el depósito principal." },
        { status: 400 }
      )
    }

    // Bloquear si tiene stock > 0 en cualquier item
    const { count: stockCount } = await supabaseAdmin
      .from("inventario_depositos")
      .select("id", { count: "exact", head: true })
      .eq("deposito_id", id)
      .gt("stock", 0)

    if ((stockCount ?? 0) > 0) {
      return NextResponse.json(
        {
          error: `El depósito tiene stock en ${stockCount} item(s). Transferí el stock antes de archivar.`,
          code: "HAS_STOCK",
        },
        { status: 409 }
      )
    }

    const { error: deleteErr } = await supabaseAdmin
      .from("depositos")
      .update({ deleted_at: new Date().toISOString(), activo: false })
      .eq("id", id)
      .eq("organization_id", organizationId!)

    if (deleteErr) throw deleteErr

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Error deleting deposito:", err)
    return NextResponse.json({ error: "Error al archivar depósito" }, { status: 500 })
  }
}
