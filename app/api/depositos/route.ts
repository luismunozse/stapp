import { NextResponse } from "next/server"
import { requireAuth, requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaEscritura } from "@/lib/sucursal"
import { z } from "zod"

const createSchema = z.object({
  nombre: z.string().trim().min(1, "Nombre requerido").max(100),
  codigo: z.string().trim().max(40).nullable().optional(),
  direccion: z.string().trim().max(300).nullable().optional(),
  notas: z.string().trim().max(500).nullable().optional(),
  principal: z.boolean().optional(),
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

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const includeInactive = searchParams.get("includeInactive") === "true"

    let query = supabaseAdmin
      .from("depositos")
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

    return NextResponse.json({ data: (data || []).map(formatDeposito) })
  } catch (err) {
    console.error("Error fetching depositos:", err)
    return NextResponse.json({ error: "Error al obtener depósitos" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { error, session, organizationId, role } = await requireAdmin()
    if (error) return error

    const sucursalId = await sucursalParaEscritura({
      role,
      organizationId: organizationId!,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    if (!sucursalId) {
      return NextResponse.json(
        { error: "La organización no tiene sucursal principal configurada" },
        { status: 500 }
      )
    }

    const body = await request.json()
    const data = createSchema.parse(body)

    // Solo 1 principal por org: si se marca principal, demote el actual.
    // Usa transacción implícita en RPC; acá lo hacemos secuencial — la unique
    // index parcial protege ante carrera.
    if (data.principal) {
      await supabaseAdmin
        .from("depositos")
        .update({ principal: false })
        .eq("organization_id", organizationId!)
        .eq("principal", true)
        .is("deleted_at", null)
    }

    const { data: row, error: insertErr } = await supabaseAdmin
      .from("depositos")
      .insert({
        organization_id: organizationId!,
        nombre: data.nombre,
        codigo: data.codigo ?? null,
        direccion: data.direccion ?? null,
        notas: data.notas ?? null,
        principal: !!data.principal,
        activo: true,
        sucursal_id: sucursalId,
      })
      .select("*")
      .single()

    if (insertErr) {
      if ((insertErr as any).code === "23505") {
        return NextResponse.json(
          { error: "Ya existe un depósito con ese nombre" },
          { status: 400 }
        )
      }
      throw insertErr
    }

    return NextResponse.json(formatDeposito(row), { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creating deposito:", err)
    return NextResponse.json({ error: "Error al crear depósito" }, { status: 500 })
  }
}
