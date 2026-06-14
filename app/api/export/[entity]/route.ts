import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import {
  arrayToCSV,
  arrayToXLSX,
  type CSVColumn,
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

interface ExportPayload {
  data: any[]
  columns: CSVColumn<any>[]
}

/**
 * GET /api/export/[entity]
 * Exporta los datos propios de la organización a CSV o XLSX.
 *
 * Portabilidad de datos: NO está gateado por plan. Cualquier organización
 * autenticada puede exportar SUS PROPIOS datos (org-scoped por organization_id),
 * en cualquier plan o estado de suscripción. El gate de plan se mantiene solo
 * para la exportación de reportes/analytics (/api/export/reportes).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entity: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { entity } = await params

    if (!VALID_ENTITIES.includes(entity as EntityType)) {
      return NextResponse.json(
        { error: `Entidad no válida: ${entity}` },
        { status: 400 }
      )
    }

    const searchParams = request.nextUrl.searchParams
    const filters = Object.fromEntries(searchParams.entries())
    const format = (filters.format || "csv").toLowerCase()

    let payload: ExportPayload
    switch (entity as EntityType) {
      case "ordenes":
        payload = await exportOrdenes(organizationId!, filters)
        break
      case "ventas":
        payload = await exportVentas(organizationId!, filters)
        break
      case "clientes":
        payload = await exportClientes(organizationId!, filters)
        break
      case "inventario":
        payload = await exportInventario(organizationId!, filters)
        break
      case "garantias":
        payload = await exportGarantias(organizationId!, filters)
        break
      default:
        return NextResponse.json(
          { error: "Entidad no soportada" },
          { status: 400 }
        )
    }

    if (format === "xlsx") {
      const buffer = await arrayToXLSX(payload.data, payload.columns)
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${entity}_${formatDateFilename()}.xlsx"`,
        },
      })
    }

    const csvContent = arrayToCSV(payload.data, payload.columns)
    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${entity}_${formatDateFilename()}.csv"`,
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
): Promise<ExportPayload> {
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

  if (filters.estado) query = query.eq("estado", filters.estado)
  if (filters.desde) query = query.gte("fecha_ingreso", filters.desde)
  if (filters.hasta) query = query.lte("fecha_ingreso", filters.hasta)

  const { data, error } = await query
  if (error) throw error
  return { data: data || [], columns: ORDENES_COLUMNS }
}

async function exportVentas(
  organizationId: string,
  filters: Record<string, string>
): Promise<ExportPayload> {
  let query = supabaseAdmin
    .from("ventas")
    .select(`*, vendedor:users!vendedor_id(nombre)`)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(10000)

  if (filters.estado) query = query.eq("estado", filters.estado)
  if (filters.desde) query = query.gte("created_at", filters.desde)
  if (filters.hasta) query = query.lte("created_at", filters.hasta)

  const { data, error } = await query
  if (error) throw error
  return { data: data || [], columns: VENTAS_COLUMNS }
}

async function exportClientes(
  organizationId: string,
  filters: Record<string, string>
): Promise<ExportPayload> {
  let query = supabaseAdmin
    .from("clientes")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(10000)

  if (filters.search) {
    query = query.or(
      `nombre.ilike.%${filters.search}%,telefono.ilike.%${filters.search}%,email.ilike.%${filters.search}%`
    )
  }

  const { data, error } = await query
  if (error) throw error
  return { data: data || [], columns: CLIENTES_COLUMNS }
}

async function exportInventario(
  organizationId: string,
  filters: Record<string, string>
): Promise<ExportPayload> {
  let query = supabaseAdmin
    .from("inventario")
    .select("*")
    .eq("organization_id", organizationId)
    .order("nombre", { ascending: true })
    .limit(10000)

  if (filters.categoria) query = query.eq("categoria", filters.categoria)
  if (filters.tipo_dispositivo)
    query = query.eq("tipo_dispositivo", filters.tipo_dispositivo)
  if (filters.proveedor_id) {
    if (filters.proveedor_id === "none") {
      query = query.is("proveedor_id", null)
    } else {
      query = query.eq("proveedor_id", filters.proveedor_id)
    }
  }
  if (filters.bajo_stock === "true") query = query.lt("stock", 5)

  const { data, error } = await query
  if (error) throw error
  return { data: data || [], columns: INVENTARIO_COLUMNS }
}

async function exportGarantias(
  organizationId: string,
  filters: Record<string, string>
): Promise<ExportPayload> {
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

  if (filters.estado) query = query.eq("estado", filters.estado)

  const { data, error } = await query
  if (error) throw error
  const filteredData = (data || []).filter((g: any) => g.orden !== null)
  return { data: filteredData, columns: GARANTIAS_COLUMNS }
}
