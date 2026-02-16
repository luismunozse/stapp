import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { isPremium } from "@/lib/subscriptions"
import { supabaseAdmin } from "@/lib/supabase"
import {
  arrayToCSV,
  ORDENES_COLUMNS,
  VENTAS_COLUMNS,
  CLIENTES_COLUMNS,
  INVENTARIO_COLUMNS,
  GARANTIAS_COLUMNS,
} from "@/lib/csv-export"

type EntityType = "ordenes" | "ventas" | "clientes" | "inventario" | "garantias"

const VALID_ENTITIES: EntityType[] = [
  "ordenes",
  "ventas",
  "clientes",
  "inventario",
  "garantias",
]

/**
 * GET /api/export/[entity]
 * Exporta datos a CSV - Solo usuarios Premium
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entity: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    // Verificar que es Premium
    const premium = await isPremium(organizationId!)
    if (!premium) {
      return NextResponse.json(
        {
          error: "La exportación de datos requiere plan Premium",
          code: "PREMIUM_REQUIRED",
        },
        { status: 403 }
      )
    }

    const { entity } = await params

    if (!VALID_ENTITIES.includes(entity as EntityType)) {
      return NextResponse.json(
        { error: `Entidad no válida: ${entity}` },
        { status: 400 }
      )
    }

    // Obtener filtros de query params
    const searchParams = request.nextUrl.searchParams
    const filters = Object.fromEntries(searchParams.entries())

    let csvContent: string
    let filename: string

    switch (entity as EntityType) {
      case "ordenes":
        csvContent = await exportOrdenes(organizationId!, filters)
        filename = `ordenes_${formatDateFilename()}.csv`
        break
      case "ventas":
        csvContent = await exportVentas(organizationId!, filters)
        filename = `ventas_${formatDateFilename()}.csv`
        break
      case "clientes":
        csvContent = await exportClientes(organizationId!, filters)
        filename = `clientes_${formatDateFilename()}.csv`
        break
      case "inventario":
        csvContent = await exportInventario(organizationId!, filters)
        filename = `inventario_${formatDateFilename()}.csv`
        break
      case "garantias":
        csvContent = await exportGarantias(organizationId!, filters)
        filename = `garantias_${formatDateFilename()}.csv`
        break
      default:
        return NextResponse.json(
          { error: "Entidad no soportada" },
          { status: 400 }
        )
    }

    // Retornar archivo CSV
    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error("Error exporting data:", error)
    return NextResponse.json(
      { error: "Error al exportar datos" },
      { status: 500 }
    )
  }
}

function formatDateFilename(): string {
  const now = new Date()
  return now.toISOString().split("T")[0].replace(/-/g, "")
}

async function exportOrdenes(
  organizationId: string,
  filters: Record<string, string>
): Promise<string> {
  let query = supabaseAdmin
    .from("ordenes_servicio")
    .select(
      `
      *,
      cliente:clientes(nombre, telefono, email),
      tecnico:users!tecnico_id(nombre)
    `
    )
    .eq("organization_id", organizationId)
    .order("fecha_ingreso", { ascending: false })
    .limit(10000)

  // Aplicar filtros
  if (filters.estado) {
    query = query.eq("estado", filters.estado)
  }
  if (filters.desde) {
    query = query.gte("fecha_ingreso", filters.desde)
  }
  if (filters.hasta) {
    query = query.lte("fecha_ingreso", filters.hasta)
  }

  const { data, error } = await query

  if (error) throw error

  return arrayToCSV(data || [], ORDENES_COLUMNS)
}

async function exportVentas(
  organizationId: string,
  filters: Record<string, string>
): Promise<string> {
  let query = supabaseAdmin
    .from("ventas")
    .select(
      `
      *,
      vendedor:users!vendedor_id(nombre)
    `
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(10000)

  // Aplicar filtros
  if (filters.estado) {
    query = query.eq("estado", filters.estado)
  }
  if (filters.desde) {
    query = query.gte("created_at", filters.desde)
  }
  if (filters.hasta) {
    query = query.lte("created_at", filters.hasta)
  }

  const { data, error } = await query

  if (error) throw error

  return arrayToCSV(data || [], VENTAS_COLUMNS)
}

async function exportClientes(
  organizationId: string,
  filters: Record<string, string>
): Promise<string> {
  let query = supabaseAdmin
    .from("clientes")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(10000)

  // Aplicar filtro de búsqueda
  if (filters.search) {
    query = query.or(
      `nombre.ilike.%${filters.search}%,telefono.ilike.%${filters.search}%,email.ilike.%${filters.search}%`
    )
  }

  const { data, error } = await query

  if (error) throw error

  return arrayToCSV(data || [], CLIENTES_COLUMNS)
}

async function exportInventario(
  organizationId: string,
  filters: Record<string, string>
): Promise<string> {
  let query = supabaseAdmin
    .from("inventario")
    .select("*")
    .eq("organization_id", organizationId)
    .order("nombre", { ascending: true })
    .limit(10000)

  // Aplicar filtros
  if (filters.categoria) {
    query = query.eq("categoria", filters.categoria)
  }
  if (filters.tipo_dispositivo) {
    query = query.eq("tipo_dispositivo", filters.tipo_dispositivo)
  }
  if (filters.bajo_stock === "true") {
    query = query.lt("stock", 5)
  }

  const { data, error } = await query

  if (error) throw error

  return arrayToCSV(data || [], INVENTARIO_COLUMNS)
}

async function exportGarantias(
  organizationId: string,
  filters: Record<string, string>
): Promise<string> {
  let query = supabaseAdmin
    .from("garantias")
    .select(
      `
      *,
      orden:ordenes_servicio(
        numero_orden,
        dispositivo,
        cliente:clientes(nombre, telefono)
      )
    `
    )
    .eq("orden.organization_id", organizationId)
    .order("fecha_vencimiento", { ascending: true })
    .limit(10000)

  // Aplicar filtros
  if (filters.estado) {
    query = query.eq("estado", filters.estado)
  }

  const { data, error } = await query

  if (error) throw error

  // Filtrar resultados donde la orden pertenece a la organización
  const filteredData = (data || []).filter((g) => g.orden !== null)

  return arrayToCSV(filteredData, GARANTIAS_COLUMNS)
}
