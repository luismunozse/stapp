import { NextRequest, NextResponse } from "next/server"
import { requireAuth, hasInventarioAccess, resolveVendedoresHabilitados } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura, type ResultadoLectura } from "@/lib/sucursal"
import {
  arrayToCSV,
  arrayToXLSX,
  type CSVColumn,
  ORDENES_COLUMNS,
  VENTAS_COLUMNS,
  CLIENTES_COLUMNS,
  inventarioColumns,
  pedidoColumns,
  GARANTIAS_COLUMNS,
} from "@/lib/csv-export"

type EntityType = "ordenes" | "ventas" | "clientes" | "inventario" | "garantias"

// Techo de la selección exportable. El límite real de la query es 10000; esto
// corta antes para que un "seleccionar todo" sobre un catálogo grande no se
// convierta en un IN gigante.
const MAX_SELECCION_IDS = 2000

// Fallback del umbral de stock bajo cuando la org no lo tiene configurado.
// Mismo default que usa el RPC de reposición (migración 168).
const UMBRAL_STOCK_BAJO_DEFAULT = 5

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
  const { entity } = await params
  const filters = Object.fromEntries(request.nextUrl.searchParams.entries())
  return runExport(entity, filters)
}

/**
 * POST /api/export/[entity]
 * Misma exportación que el GET, pero con la selección en el body.
 *
 * Existe por longitud de URL: una selección de cientos de items no entra en
 * un query string (los ids son cuid, ~25 chars cada uno). El GET con `ids`
 * sigue andando para selecciones chicas.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ entity: string }> }
) {
  const { entity } = await params

  let body: { ids?: unknown; preset?: unknown; format?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 })
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === "string" && id.length > 0)
    : []

  // Sin ids el POST no tiene sentido: exportar todo es el GET. Cortar acá
  // evita que una selección vacía baje el inventario entero por accidente.
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "No hay items seleccionados" },
      { status: 400 }
    )
  }
  if (ids.length > MAX_SELECCION_IDS) {
    return NextResponse.json(
      { error: `La selección supera los ${MAX_SELECCION_IDS} items` },
      { status: 400 }
    )
  }

  const filters: Record<string, string> = { ids: ids.join(",") }
  if (typeof body.preset === "string") filters.preset = body.preset
  if (typeof body.format === "string") filters.format = body.format

  return runExport(entity, filters)
}

async function runExport(entity: string, filters: Record<string, string>) {
  try {
    const { error, organizationId, role, session } = await requireAuth()
    if (error) return error

    if (!VALID_ENTITIES.includes(entity as EntityType)) {
      return NextResponse.json(
        { error: `Entidad no válida: ${entity}` },
        { status: 400 }
      )
    }

    const format = (filters.format || "csv").toLowerCase()

    const lectura = await sucursalParaLectura({
      role,
      userSucursalId: session!.user.sucursalId ?? null,
    })

    let payload: ExportPayload
    switch (entity as EntityType) {
      case "ordenes":
        payload = await exportOrdenes(organizationId!, filters, lectura)
        break
      case "ventas":
        payload = await exportVentas(organizationId!, filters, lectura)
        break
      case "clientes":
        payload = await exportClientes(organizationId!, filters)
        break
      case "inventario": {
        // El costo de compra sigue hasInventarioAccess, igual que los endpoints
        // de inventario. El round-trip a organizations solo hace falta para
        // VENDEDOR; los demás roles se resuelven sin consultar.
        const vendedoresHabilitados = role === "VENDEDOR"
          ? await resolveVendedoresHabilitados(organizationId!)
          : false
        const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)
        payload = await exportInventario(organizationId!, filters, canViewCost)
        break
      }
      case "garantias":
        payload = await exportGarantias(organizationId!, filters)
        break
      default:
        return NextResponse.json(
          { error: "Entidad no soportada" },
          { status: 400 }
        )
    }

    // El pedido no es el inventario: que el archivo no se llame igual, o el
    // usuario termina mandándole al proveedor el dump equivocado.
    const basename = filters.preset === "pedido" ? "pedido" : entity

    if (format === "xlsx") {
      const buffer = await arrayToXLSX(payload.data, payload.columns)
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${basename}_${formatDateFilename()}.xlsx"`,
        },
      })
    }

    const csvContent = arrayToCSV(payload.data, payload.columns)
    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${basename}_${formatDateFilename()}.csv"`,
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
  filters: Record<string, string>,
  lectura: ResultadoLectura
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

  if (!lectura.verTodas && lectura.sucursalId)
    query = query.eq("sucursal_id", lectura.sucursalId)

  if (filters.estado) query = query.eq("estado", filters.estado)
  if (filters.desde) query = query.gte("fecha_ingreso", filters.desde)
  if (filters.hasta) query = query.lte("fecha_ingreso", filters.hasta)

  const { data, error } = await query
  if (error) throw error
  return { data: data || [], columns: ORDENES_COLUMNS }
}

async function exportVentas(
  organizationId: string,
  filters: Record<string, string>,
  lectura: ResultadoLectura
): Promise<ExportPayload> {
  let query = supabaseAdmin
    .from("ventas")
    .select(`*, vendedor:users!vendedor_id(nombre)`)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(10000)

  if (!lectura.verTodas && lectura.sucursalId)
    query = query.eq("sucursal_id", lectura.sucursalId)

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
  filters: Record<string, string>,
  canViewCost: boolean
): Promise<ExportPayload> {
  const esPedido = filters.preset === "pedido"

  // El pedido necesita el proveedor real (FK) y los umbrales por item para
  // sugerir la cantidad; el export genérico se queda con el select de siempre.
  const select = esPedido
    ? "id, codigo, nombre, categoria, stock, stock_minimo, stock_maximo, punto_reorden, precio_compra, proveedor, proveedores:proveedor_id(nombre)"
    : "*"

  let query = supabaseAdmin
    .from("inventario")
    .select(select)
    .eq("organization_id", organizationId)
    .order("nombre", { ascending: true })
    .limit(10000)

  // Selección explícita del usuario. El .eq de organization_id de arriba se
  // mantiene, así que un id de otra org no devuelve nada (anti-IDOR).
  const ids = parseIds(filters.ids)
  if (ids.length > 0) query = query.in("id", ids)

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

  if (esPedido) {
    const umbralOrg = await resolveUmbralStockBajo(organizationId)
    return {
      data: data || [],
      columns: pedidoColumns(canViewCost, umbralOrg),
    }
  }

  return { data: data || [], columns: inventarioColumns(canViewCost) }
}

function parseIds(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
    .slice(0, MAX_SELECCION_IDS)
}

async function resolveUmbralStockBajo(organizationId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from("organizations")
    .select("umbral_stock_bajo")
    .eq("id", organizationId)
    .single()
  return data?.umbral_stock_bajo ?? UMBRAL_STOCK_BAJO_DEFAULT
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
      orden:ordenes_servicio!inner(
        numero_orden,
        dispositivo,
        cliente:clientes(nombre, telefono)
      )
    `
    )
    .eq("ordenes_servicio.organization_id", organizationId)
    .order("fecha_vencimiento", { ascending: true })
    .limit(10000)

  if (filters.estado) query = query.eq("estado", filters.estado)

  const { data, error } = await query
  if (error) throw error
  const filteredData = (data || []).filter((g: any) => g.orden !== null)
  return { data: filteredData, columns: GARANTIAS_COLUMNS }
}
