import { z } from "zod"
import { supabaseAdmin } from "@/lib/supabase"
import { combinarOr, terminoDeBusquedaSeguro } from "@/lib/sucursal-ordenes"
import { puedeVerDeudaClientes } from "@/lib/auth-utils"
import { alcanceListaOrdenes } from "./alcance-lista"
import { SELECT_ORDEN_LISTA, ordenResumida } from "./formato-orden"
import type { ContextoHerramienta, Herramienta } from "./tipos"

const inputSchema = z.object({
  busqueda: z.string().trim().min(2).max(80),
})

/** Coincidencias que se listan, y cuántas se detallan (deuda y órdenes) para no gastar de más. */
const MAX_COINCIDENCIAS = 5
const MAX_DETALLADOS = 3
const ORDENES_POR_CLIENTE = 5

/**
 * La deuda de un cliente la ven ADMIN y VENDEDOR. Un TECNICO solo si la organización activó
 * `tecnicos_ven_deuda_clientes` (decisión del dueño, 2026-11-12). Fail-closed.
 */
export function puedeVerDeuda(ctx: ContextoHerramienta): Promise<boolean> {
  return puedeVerDeudaClientes(ctx.actor.role, ctx.actor.organizationId)
}

async function deudaDe(clienteId: string, ctx: ContextoHerramienta) {
  // Misma fuente que la pantalla del cliente (/api/clientes/[id]/deuda-sucursal).
  const { data, error } = await supabaseAdmin.rpc("get_deuda_cliente_sucursal", {
    p_org_id: ctx.actor.organizationId,
    p_cliente_id: clienteId,
    p_sucursal_id: ctx.filtroLectura.verTodas ? null : ctx.filtroLectura.sucursalId,
  })
  if (error) throw new Error(`get_deuda_cliente_sucursal: ${error.message}`)
  const fila = Array.isArray(data) ? data[0] : data
  return {
    total: Number(fila?.deuda_total ?? 0),
    fiado: Number(fila?.deuda_fiado ?? 0),
    ordenes: Number(fila?.deuda_ordenes ?? 0),
  }
}

async function ordenesRecientes(clienteId: string, ctx: ContextoHerramienta) {
  let query: any = supabaseAdmin
    .from("ordenes_servicio")
    .select(SELECT_ORDEN_LISTA)
    .eq("organization_id", ctx.actor.organizationId)
    .eq("cliente_id", clienteId)
  const alcance = await alcanceListaOrdenes(ctx)
  if (alcance.eq) query = query.eq(...alcance.eq)
  if (alcance.or) query = query.or(combinarOr(alcance.or))
  const { data, error } = await query.order("fecha_ingreso", { ascending: false }).limit(ORDENES_POR_CLIENTE)
  if (error) throw new Error(`ordenes del cliente: ${error.message}`)
  return (data ?? []).map((o: any) => ordenResumida(o))
}

export const resumenCliente: Herramienta = {
  definicion: {
    name: "resumen_cliente",
    description:
      "Busca clientes por nombre o teléfono y devuelve sus datos de contacto, sus últimas órdenes y cuánto debe (fiado más órdenes sin cobrar). Si hay varias coincidencias devuelve la lista para que el usuario elija. La deuda solo viene si el usuario tiene permiso; si no, el campo dice que no tiene permiso.",
    input_schema: {
      type: "object",
      properties: {
        busqueda: { type: "string", description: "Nombre (o parte) o teléfono del cliente." },
      },
      required: ["busqueda"],
      additionalProperties: false,
    },
    strict: true,
  },

  // Los clientes son de toda la organización para los tres roles (igual que la pantalla Clientes).
  disponible: () => true,

  async ejecutar(input, ctx) {
    const { busqueda } = inputSchema.parse(input)
    const termino = terminoDeBusquedaSeguro(busqueda)

    const { data: clientes, error } = await supabaseAdmin
      .from("clientes")
      .select("id, nombre, telefono, email")
      .eq("organization_id", ctx.actor.organizationId)
      .or(`nombre.ilike.%${termino}%,telefono.ilike.%${termino}%`)
      .order("nombre", { ascending: true })
      .limit(MAX_COINCIDENCIAS)
    if (error) throw new Error(`clientes: ${error.message}`)
    if (!clientes || clientes.length === 0) {
      return { datos: { encontrados: 0, mensaje: `No hay clientes que coincidan con "${busqueda}".` }, filas: 0 }
    }

    const verDeuda = await puedeVerDeuda(ctx)
    const resultado = await Promise.all(
      clientes.map(async (c: { id: string; nombre: string; telefono: string | null; email: string | null }, i: number) => {
        const base = { id: c.id, link: `/clientes/${c.id}`, nombre: c.nombre, telefono: c.telefono, email: c.email }
        if (i >= MAX_DETALLADOS) return base
        const [deuda, ordenes] = await Promise.all([
          verDeuda ? deudaDe(c.id, ctx) : Promise.resolve("sin permiso para ver la deuda" as const),
          ordenesRecientes(c.id, ctx),
        ])
        return { ...base, deuda, ultimasOrdenes: ordenes }
      })
    )

    return {
      datos: {
        encontrados: resultado.length,
        ...(resultado.length === MAX_COINCIDENCIAS && { aviso: "Puede haber más coincidencias: pedile al usuario un dato más preciso." }),
        moneda: ctx.moneda,
        clientes: resultado,
      },
      filas: resultado.length,
    }
  },
}
