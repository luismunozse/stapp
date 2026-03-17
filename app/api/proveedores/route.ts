import { NextResponse } from "next/server"
import { requireAuth, requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatProveedor } from "@/lib/db-utils"
import { z } from "zod"

const proveedorSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido"),
  telefono: z.string().optional(),
  whatsapp: z.string().optional(),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  direccion: z.string().optional(),
  website: z.string().url("URL inválida").optional().or(z.literal("")),
  notas: z.string().optional(),
  activo: z.boolean().optional().default(true),
})

export async function GET() {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { data: proveedores, error: dbError } = await supabaseAdmin
      .from("proveedores")
      .select("*")
      .eq("organization_id", organizationId!)
      .order("nombre", { ascending: true })

    if (dbError) {
      throw dbError
    }

    return NextResponse.json(proveedores?.map(formatProveedor))
  } catch (error) {
    console.error("Error fetching proveedores:", error)
    return NextResponse.json(
      { error: "Error al obtener proveedores" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error

    const body = await request.json()
    const data = proveedorSchema.parse(body)

    const { data: proveedor, error: dbError } = await supabaseAdmin
      .from("proveedores")
      .insert({
        nombre: data.nombre,
        telefono: data.telefono || null,
        whatsapp: data.whatsapp || null,
        email: data.email || null,
        direccion: data.direccion || null,
        website: data.website || null,
        notas: data.notas || null,
        activo: data.activo,
        organization_id: organizationId!,
      })
      .select()
      .single()

    if (dbError) {
      if (dbError.code === "23505") {
        return NextResponse.json(
          { error: "Ya existe un proveedor con ese nombre" },
          { status: 400 }
        )
      }
      throw dbError
    }

    return NextResponse.json(formatProveedor(proveedor), { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating proveedor:", error)
    return NextResponse.json(
      { error: "Error al crear proveedor" },
      { status: 500 }
    )
  }
}
