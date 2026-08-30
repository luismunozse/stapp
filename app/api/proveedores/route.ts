import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatProveedor } from "@/lib/db-utils"
import { z } from "zod"

const CONDICION_IVA = [
  "RESPONSABLE_INSCRIPTO",
  "MONOTRIBUTO",
  "EXENTO",
  "NO_RESPONSABLE",
  "CONSUMIDOR_FINAL",
] as const

const CONDICION_PAGO = ["CONTADO", "CTA_CTE", "TRANSFERENCIA", "CHEQUE", "OTRO"] as const

const whatsappValidator = z
  .string()
  .optional()
  .refine(
    (v) => !v || /^\d{10,15}$/.test(v.replace(/\D/g, "")),
    "WhatsApp inválido: 10-15 dígitos"
  )

const proveedorSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido"),
  telefono: z.string().optional(),
  whatsapp: whatsappValidator,
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  direccion: z.string().optional(),
  website: z.string().url("URL inválida").optional().or(z.literal("")),
  notas: z.string().optional(),
  activo: z.boolean().optional().default(true),
  razonSocial: z.string().optional(),
  cuit: z.string().optional(),
  condicionIva: z.enum(CONDICION_IVA).optional().or(z.literal("")),
  ingresosBrutos: z.string().optional(),
  condicionPago: z.enum(CONDICION_PAGO).optional().or(z.literal("")),
  diasPago: z.number().int().min(0).max(365).optional().nullable(),
  leadTimeDias: z.number().int().min(0).max(365).optional().nullable(),
  pedidoMinimo: z.number().min(0).optional().nullable(),
  rating: z.number().int().min(1).max(5).optional().nullable(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
})

export async function GET() {
  try {
    // Todas las escrituras de este namespace ya iban por
    // requireAdminOrVendedor; las lecturas se habian quedado en
    // requireAuth, asi que un TECNICO listaba los proveedores de la org,
    // abria su ficha y se bajaba adjuntos y contactos.
    //
    // No es requireAdmin porque GET /api/proveedores lo consume tambien
    // el selector de proveedor de inventario y el alta de ordenes de
    // compra: cerrarlo del todo rompia el alta de articulos para un
    // VENDEDOR con el permiso 275. El gate del PRECIO DE COMPRA es otro
    // eje y sigue intacto: hasInventarioAccess, adentro de cada handler.
    const { error, organizationId } = await requireAdminOrVendedor()
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
        whatsapp: data.whatsapp ? data.whatsapp.replace(/\D/g, "") : null,
        email: data.email || null,
        direccion: data.direccion || null,
        website: data.website || null,
        notas: data.notas || null,
        activo: data.activo,
        razon_social: data.razonSocial || null,
        cuit: data.cuit || null,
        condicion_iva: data.condicionIva || null,
        ingresos_brutos: data.ingresosBrutos || null,
        condicion_pago: data.condicionPago || null,
        dias_pago: data.diasPago ?? null,
        lead_time_dias: data.leadTimeDias ?? null,
        pedido_minimo: data.pedidoMinimo ?? null,
        rating: data.rating ?? null,
        tags: data.tags && data.tags.length > 0 ? data.tags : null,
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
