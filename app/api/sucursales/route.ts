import { NextResponse } from "next/server"
import { requireAuth, requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { enforcePlanLimit } from "@/lib/plan-limits"
import { z } from "zod"

const createSchema = z.object({
  nombre: z.string().trim().min(1, "Nombre requerido").max(100),
  codigo: z.string().trim().max(40).nullable().optional(),
  direccion: z.string().trim().max(300).nullable().optional(),
  telefono: z.string().trim().max(40).nullable().optional(),
  notas: z.string().trim().max(500).nullable().optional(),
  principal: z.boolean().optional(),
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

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const includeInactive = searchParams.get("includeInactive") === "true"

    let query = supabaseAdmin
      .from("sucursales")
      .select("*")
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .order("principal", { ascending: false })
      .order("nombre", { ascending: true })

    if (!includeInactive) {
      query = query.eq("activo", true)
    }

    const { data, error: dbErr } = await query
    if (dbErr) throw dbErr

    return NextResponse.json({ data: (data || []).map(formatSucursal) })
  } catch (err) {
    console.error("Error fetching sucursales:", err)
    return NextResponse.json({ error: "Error al obtener sucursales" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    // Gate de plan: FREE=1, Profesional=3, Pro=ilimitado.
    const limitError = await enforcePlanLimit(organizationId!, "sucursales")
    if (limitError) return limitError

    const body = await request.json()
    const data = createSchema.parse(body)

    // Solo 1 principal por org: si se marca principal, demote el actual.
    // La unique index parcial protege ante carrera.
    if (data.principal) {
      await supabaseAdmin
        .from("sucursales")
        .update({ principal: false })
        .eq("organization_id", organizationId!)
        .eq("principal", true)
        .is("deleted_at", null)
    }

    const { data: row, error: insertErr } = await supabaseAdmin
      .from("sucursales")
      .insert({
        organization_id: organizationId!,
        nombre: data.nombre,
        codigo: data.codigo ?? null,
        direccion: data.direccion ?? null,
        telefono: data.telefono ?? null,
        notas: data.notas ?? null,
        principal: !!data.principal,
        activo: true,
      })
      .select("*")
      .single()

    if (insertErr) {
      if ((insertErr as any).code === "23505") {
        return NextResponse.json(
          { error: "Ya existe una sucursal con ese nombre" },
          { status: 400 }
        )
      }
      throw insertErr
    }

    return NextResponse.json(formatSucursal(row), { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creating sucursal:", err)
    return NextResponse.json({ error: "Error al crear sucursal" }, { status: 500 })
  }
}
