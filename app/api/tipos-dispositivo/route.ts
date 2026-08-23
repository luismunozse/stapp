import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"
import { DEFAULT_TIPO_CONFIG } from "@/lib/tipos-dispositivo-defaults"
import { seedOrganizationFromRubro } from "@/lib/rubros/seed"

const tipoDispositivoSchema = z.object({
  codigo: z
    .string()
    .min(1, "El código es requerido")
    .max(20, "El código no puede tener más de 20 caracteres")
    .regex(/^[A-Z0-9_]+$/, "El código solo puede contener letras mayúsculas, números y guiones bajos"),
  nombre: z
    .string()
    .min(1, "El nombre es requerido")
    .max(50, "El nombre no puede tener más de 50 caracteres"),
  prefijoOrden: z
    .string()
    .min(1, "El prefijo es requerido")
    .max(10, "El prefijo no puede tener más de 10 caracteres")
    .regex(/^[A-Z0-9]+$/, "El prefijo solo puede contener letras mayúsculas y números"),
  icono: z.string().optional(),
  config: z.any().optional(),
})

const DEFAULT_CONFIG = DEFAULT_TIPO_CONFIG

function formatTipoDispositivo(tipo: any) {
  return {
    id: tipo.id,
    codigo: tipo.codigo,
    nombre: tipo.nombre,
    prefijoOrden: tipo.prefijo_orden,
    icono: tipo.icono,
    activo: tipo.activo,
    esBase: tipo.es_base,
    orden: tipo.orden,
    config: tipo.config || {},
  }
}

/**
 * Red de seguridad: si una organizacion no tiene ningun tipo de equipo, la
 * sembramos con el pack de su rubro.
 *
 * Antes esta funcion tenia los ocho tipos de electronica escritos a mano, en
 * paralelo a la funcion SQL `poblar_tipos_dispositivo_base()`: dos fuentes de
 * verdad que podian divergir sin que nadie se enterara. Ahora ambas apuntan al
 * mismo registro de `lib/rubros`.
 *
 * Cubre las altas que no pasan por /api/auth/register (superadmin, scripts) y
 * las orgs viejas que hayan quedado vacias.
 */
async function ensureTiposExist(organizationId: string) {
  const { count } = await supabaseAdmin
    .from("tipos_dispositivo")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)

  if (count && count > 0) return

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("rubro")
    .eq("id", organizationId)
    .single()

  const result = await seedOrganizationFromRubro(organizationId, org?.rubro ?? null)
  if (result.errors.length > 0) {
    console.error("ensureTiposExist seed errors:", result.errors)
  }
}

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const incluirTodos = searchParams.get("incluirTodos") === "true"
    const soloActivos = searchParams.get("soloActivos") !== "false"

    // Auto-seed: si la org no tiene tipos, crearlos
    await ensureTiposExist(organizationId!)

    let query = supabaseAdmin
      .from("tipos_dispositivo")
      .select("*")
      .eq("organization_id", organizationId!)
      .order("orden", { ascending: true })

    if (soloActivos) {
      query = query.eq("activo", true)
    }

    if (!incluirTodos) {
      query = query.neq("codigo", "TODOS")
    }

    const { data, error: dbError } = await query

    if (dbError) {
      throw dbError
    }

    return NextResponse.json(data?.map(formatTipoDispositivo) || [])
  } catch (error) {
    console.error("Error fetching tipos dispositivo:", error)
    return NextResponse.json(
      { error: "Error al obtener tipos de dispositivo" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "No autorizado. Solo administradores pueden crear tipos." },
        { status: 403 }
      )
    }

    const body = await request.json()
    const data = tipoDispositivoSchema.parse(body)

    // Obtener el orden máximo actual
    const { data: maxOrdenResult } = await supabaseAdmin
      .from("tipos_dispositivo")
      .select("orden")
      .eq("organization_id", organizationId!)
      .order("orden", { ascending: false })
      .limit(1)
      .single()

    const nuevoOrden = (maxOrdenResult?.orden || 0) + 1

    const { data: tipo, error: dbError } = await supabaseAdmin
      .from("tipos_dispositivo")
      .insert({
        organization_id: organizationId!,
        codigo: data.codigo.toUpperCase(),
        nombre: data.nombre,
        prefijo_orden: data.prefijoOrden.toUpperCase(),
        icono: data.icono || null,
        es_base: false,
        orden: nuevoOrden,
        config: data.config || DEFAULT_CONFIG,
      })
      .select()
      .single()

    if (dbError) {
      if (dbError.code === "23505") {
        return NextResponse.json(
          { error: "Ya existe un tipo con ese código" },
          { status: 400 }
        )
      }
      console.error("DB Error creating tipo dispositivo:", dbError)
      return NextResponse.json(
        { error: `Error de base de datos: ${dbError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json(formatTipoDispositivo(tipo), { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating tipo dispositivo:", error)
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json(
      { error: `Error al crear tipo de dispositivo: ${message}` },
      { status: 500 }
    )
  }
}
