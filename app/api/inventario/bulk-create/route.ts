import { NextResponse } from "next/server"
import { requireInventarioAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatInventario } from "@/lib/db-utils"
import { createAuditLogger } from "@/lib/audit"
import { z } from "zod"

const CATEGORIA_PREFIJOS: Record<string, string> = {
  "Baterías": "BAT",
  "Pantallas": "PAN",
  "Protectores": "PRO",
  "Fundas": "FUN",
  "Cargadores": "CAR",
  "Flex": "FLX",
  "Módulos": "MOD",
  "Teclados": "TEC",
  "Memorias": "MEM",
  "Discos": "DIS",
  "Joysticks": "JOY",
  "Fuentes": "FUE",
  "Lectoras": "LEC",
  "Coolers": "COO",
  "Mallas": "MAL",
  "Auriculares": "AUR",
  "Parlantes": "PAR",
  "Cables": "CAB",
  "Adaptadores": "ADP",
  "Soportes": "SOP",
  "Otros": "OTR",
}

const itemSchema = z.object({
  nombre: z.string().min(1),
  categoria: z.string().min(1),
  tipoDispositivo: z.string().min(1),
  stock: z.number().int().min(0),
  precioCompra: z.number().min(0),
  precioVenta: z.number().min(0),
  proveedorId: z.string().min(1).nullable().optional(),
  stockMinimo: z.number().int().min(0).nullable().optional(),
  stockMaximo: z.number().int().min(0).nullable().optional(),
  puntoReorden: z.number().int().min(0).nullable().optional(),
  barcode: z.string().nullable().optional(),
})

const bulkSchema = z.object({
  items: z.array(itemSchema).min(1).max(100),
})

function prefixFor(categoria: string) {
  return CATEGORIA_PREFIJOS[categoria] || categoria.substring(0, 3).toUpperCase()
}

export async function POST(request: Request) {
  try {
    const { error, organizationId, userId } = await requireInventarioAccess()
    if (error) return error

    const body = await request.json()
    const { items } = bulkSchema.parse(body)

    const created: unknown[] = []
    const errors: { index: number; nombre: string; error: string }[] = []
    const auditLogger = userId ? createAuditLogger(organizationId!, userId, request) : null

    // Procesar secuencial para que get_next_inventory_code vea inserts previos
    // y no asigne códigos duplicados dentro del mismo lote.
    for (let i = 0; i < items.length; i++) {
      const data = items[i]
      try {
        const prefijo = prefixFor(data.categoria)
        const { data: codigo, error: rpcError } = await supabaseAdmin.rpc(
          "get_next_inventory_code",
          { p_org_id: organizationId!, p_prefix: prefijo }
        )
        if (rpcError) throw rpcError

        const { data: inserted, error: insertError } = await supabaseAdmin
          .from("inventario")
          .insert({
            codigo,
            nombre: data.nombre,
            descripcion: null,
            categoria: data.categoria,
            tipo_dispositivo: data.tipoDispositivo,
            stock: data.stock,
            precio_compra: data.precioCompra,
            precio_venta: data.precioVenta,
            proveedor: null,
            proveedor_id: data.proveedorId ?? null,
            stock_minimo: data.stockMinimo ?? null,
            stock_maximo: data.stockMaximo ?? null,
            punto_reorden: data.puntoReorden ?? null,
            barcode: data.barcode?.trim() || null,
            organization_id: organizationId!,
          })
          .select("*, proveedores:proveedor_id(id, nombre)")
          .single()

        if (insertError) throw insertError
        // Detrás de requireInventarioAccess(): el permiso de costo ya está
        // resuelto por el guard de la ruta.
        created.push(formatInventario(inserted, true))
        if (auditLogger) {
          auditLogger.create("inventario", inserted.id, {
            codigo: inserted.codigo,
            nombre: inserted.nombre,
            categoria: inserted.categoria,
            tipo_dispositivo: inserted.tipo_dispositivo,
            stock: inserted.stock,
            precio_compra: inserted.precio_compra,
            precio_venta: inserted.precio_venta,
            origen: "bulk-create",
          }).catch(() => {})
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error desconocido"
        errors.push({ index: i, nombre: data.nombre, error: msg })
      }
    }

    return NextResponse.json(
      { created, errors, createdCount: created.length, errorCount: errors.length },
      { status: errors.length === 0 ? 201 : 207 }
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message, path: error.errors[0].path },
        { status: 400 }
      )
    }
    console.error("Error en bulk-create inventario:", error)
    return NextResponse.json(
      { error: "Error al crear items en lote" },
      { status: 500 }
    )
  }
}
