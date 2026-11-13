import { NextResponse } from "next/server"
import { requireAuth, requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { validarMonedaEscritura } from "@/lib/currency/catalogo"
import { cargarConfigMoneda } from "@/lib/currency/tipo-cambio.server"
import { z } from "zod"

const servicioSchema = z.object({
  codigo: z.string().min(1, "El código es requerido").max(40),
  nombre: z.string().min(1, "El nombre es requerido").max(120),
  descripcion: z.string().max(500).nullable().optional(),
  categoria: z.string().max(80).nullable().optional(),
  precio: z.number().min(0, "El precio no puede ser negativo"),
  duracionEstimadaMin: z.number().int().positive().nullable().optional(),
  activo: z.boolean().default(true),
  // Currency of the price: null = the organization's local currency. Any string passes the schema
  // on purpose: validarMonedaEscritura owns the business rule and its message.
  moneda: z.string().nullable().optional(),
})

function toDTO(s: any) {
  return {
    id: s.id,
    codigo: s.codigo,
    nombre: s.nombre,
    descripcion: s.descripcion,
    categoria: s.categoria,
    precio: Number(s.precio),
    duracionEstimadaMin: s.duracion_estimada_min,
    activo: s.activo,
    moneda: (s.moneda ?? null) as "USD" | "EUR" | null,
  }
}

// GET - Lista los servicios del catálogo de la organización.
// requireAuth (no requireAdmin): un técnico necesita leer el catálogo para
// asignar servicios a su orden, aunque no pueda administrarlo.
export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const incluirInactivos = searchParams.get("incluirInactivos") === "true"
    const buscar = searchParams.get("buscar")?.trim()
    // "local" = priced in the local currency, "divisa" = priced in a foreign one; anything else = all.
    const monedaFiltro = searchParams.get("moneda")

    let query = supabaseAdmin
      .from("servicios")
      .select("*")
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .order("nombre", { ascending: true })

    if (!incluirInactivos) query = query.eq("activo", true)
    if (buscar) query = query.ilike("nombre", `%${buscar}%`)
    if (monedaFiltro === "local") query = query.is("moneda", null)
    else if (monedaFiltro === "divisa") query = query.not("moneda", "is", null)

    const { data, error: dbError } = await query

    if (dbError) {
      console.error("Error fetching servicios:", dbError)
      return NextResponse.json({ error: "Error al obtener servicios" }, { status: 500 })
    }

    return NextResponse.json({ servicios: (data || []).map(toDTO) })
  } catch (err) {
    console.error("Error fetching servicios:", err)
    return NextResponse.json({ error: "Error al obtener servicios" }, { status: 500 })
  }
}

// POST - Alta en el catálogo. Solo ADMIN: los precios son decisión comercial.
export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const parsed = servicioSchema.parse(body)

    // No currency asked for = local (explicit null); the config is read only when one is asked for.
    let moneda: "USD" | "EUR" | null = null
    if (parsed.moneda != null) {
      const { config } = await cargarConfigMoneda(organizationId!)
      const validacion = validarMonedaEscritura(parsed.moneda, undefined, config)
      if (!validacion.ok) return NextResponse.json({ error: validacion.error }, { status: 400 })
      moneda = validacion.moneda
    }

    const { data, error: insertError } = await supabaseAdmin
      .from("servicios")
      .insert({
        organization_id: organizationId!,
        codigo: parsed.codigo,
        nombre: parsed.nombre,
        descripcion: parsed.descripcion || null,
        categoria: parsed.categoria || null,
        precio: parsed.precio,
        duracion_estimada_min: parsed.duracionEstimadaMin || null,
        activo: parsed.activo,
        moneda,
      })
      .select("*")
      .single()

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json(
          { error: "Ya existe un servicio con ese código" },
          { status: 400 }
        )
      }
      console.error("Error creating servicio:", insertError)
      return NextResponse.json({ error: "Error al crear el servicio" }, { status: 500 })
    }

    return NextResponse.json({ servicio: toDTO(data) }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0].message }, { status: 400 })
    }
    console.error("Error creating servicio:", err)
    return NextResponse.json({ error: "Error al crear el servicio" }, { status: 500 })
  }
}
