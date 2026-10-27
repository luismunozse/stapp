/**
 * El documento de una nota de crédito: todo lo que necesitan el PDF, el
 * ticket y el mensaje de WhatsApp, venga del motor que venga.
 *
 * El alcance es el de la operación de origen: quien ve la venta o la orden ve
 * sus NC (spec, "Permisos": el bloque del detalle no cambia quién ve qué).
 *   - Venta: las reglas de GET /api/ventas/[id] — acceso al POS (el técnico
 *     solo con `tecnicos_operan_pos`), sus propias ventas si no es ADMIN y la
 *     sucursal de lectura.
 *   - Orden: las de GET /api/ordenes/[id] — la organización, y el técnico
 *     solo sus órdenes.
 * Lo que no se ve devuelve null, igual que lo inexistente: la ruta responde
 * 404 sin distinguir.
 */
import { supabaseAdmin } from "@/lib/supabase"
import { hasPosAccess, resolveTecnicosOperanPos, soloVeSusVentas } from "@/lib/auth-utils"
import { sucursalParaLectura } from "@/lib/sucursal"
import { cargarOrdenEnAlcance } from "@/lib/ordenes/alcance"
import { saldoPendienteVenta } from "@/lib/db-utils"
import { pendienteOrden, aplicadoNotasCreditoDeOrden, NOTAS_CREDITO_APLICADO_EMBED } from "@/lib/ordenes/pendiente"
import { isMissingColumnError } from "@/lib/db-errors"
import { DEFAULT_TIMEZONE } from "@/lib/timezone"
import { CONSUMIDOR_FINAL, esMotivoNC, numeroOperacion, type ModoNC, type MotivoNC, type OrigenNC } from "./catalogo"
import { COLUMNAS_VISTA_NC, dinero, type FilaVistaNC } from "./listado"

export const NC_NO_ENCONTRADA = "Nota de crédito no encontrada"

export interface LectorNC {
  organizationId: string
  userId: string
  role: string | null
  userSucursalId: string | null
}

export interface ItemDocumentoNC {
  descripcion: string
  cantidad: number
  precioUnitario: number
  subtotal: number
}

export interface EmisorDocumentoNC {
  nombreEmpresa: string | null
  telefonoEmpresa: string | null
  direccionEmpresa: string | null
  domicilioFiscalEmpresa: string | null
  cuitEmpresa: string | null
  condicionIvaEmpresa: string | null
  pais: string | null
  logoUrl: string | null
  moneda: string | null
  zonaHoraria: string
}

export interface ClienteDocumentoNC {
  nombre: string
  dni: string | null
  telefono: string | null
  email: string | null
  direccion: string | null
}

export interface NotaCreditoDocumento {
  id: string
  origen: OrigenNC
  origenId: string
  origenNumero: string
  numero: string
  fecha: string
  modo: ModoNC
  motivoNc: MotivoNC | null
  detalle: string | null
  observaciones: string | null
  items: ItemDocumentoNC[]
  monto: number
  montoAplicadoDeuda: number
  montoReembolso: number
  metodo: string | null
  pendienteActual: number | null
  anulada: boolean
  anuladaAt: string | null
  anuladaMotivo: string | null
  cliente: ClienteDocumentoNC
  sucursalNombre: string | null
  atendidoPor: string | null
  emisor: EmisorDocumentoNC
}

/** Lo que cada motor aporta además de la fila de la vista. */
interface ParteMotor {
  observaciones: string | null
  items: ItemDocumentoNC[]
  pendienteActual: number | null
  anuladaAt: string | null
  anuladaMotivo: string | null
  /** Nombre y teléfono que la operación guarda por su cuenta (venta de mostrador, contacto de la orden). */
  contacto: { nombre: string | null; telefono: string | null }
}

async function parteDeVenta(fila: FilaVistaNC, lector: LectorNC): Promise<ParteMotor | null> {
  const tecnicosOperanPos = lector.role === "TECNICO" ? await resolveTecnicosOperanPos(lector.organizationId) : false
  if (!hasPosAccess(lector.role, tecnicosOperanPos)) return null

  let qVenta = supabaseAdmin
    .from("ventas")
    .select("id, cliente_nombre, cliente_telefono, total, monto_abonado, estado, devoluciones_venta (monto_aplicado_deuda)")
    .eq("id", fila.origen_id)
    .eq("organization_id", lector.organizationId)
  if (soloVeSusVentas(lector.role)) qVenta = qVenta.eq("vendedor_id", lector.userId)
  const filtro = await sucursalParaLectura({ role: lector.role, userSucursalId: lector.userSucursalId })
  if (!filtro.verTodas && filtro.sucursalId) qVenta = qVenta.eq("sucursal_id", filtro.sucursalId)

  const { data: venta, error: ventaError } = await qVenta.maybeSingle()
  if (ventaError) throw ventaError
  if (!venta) return null

  const { data: dev, error: devError } = await supabaseAdmin
    .from("devoluciones_venta")
    .select("observaciones, anulada_at, anulada_motivo, items_devolucion (cantidad, precio_unitario, subtotal, items_venta (descripcion))")
    .eq("id", fila.id)
    .eq("organization_id", lector.organizationId)
    .maybeSingle()
  if (devError) throw devError
  if (!dev) return null

  return {
    observaciones: dev.observaciones ?? null,
    items: ((dev.items_devolucion ?? []) as unknown as Array<{
      cantidad: number
      precio_unitario: string | number
      subtotal: string | number
      items_venta: { descripcion: string | null } | null
    }>).map((i) => ({
      descripcion: i.items_venta?.descripcion || "Producto",
      cantidad: Number(i.cantidad) || 0,
      precioUnitario: dinero(i.precio_unitario),
      subtotal: dinero(i.subtotal),
    })),
    // saldoPendienteVenta es la fuente única del saldo de una venta (resta lo
    // que ya descontaron sus NC). Una venta anulada no tiene saldo que mostrar.
    pendienteActual: venta.estado === "ANULADA" ? null : saldoPendienteVenta(venta),
    anuladaAt: dev.anulada_at ?? null,
    anuladaMotivo: dev.anulada_motivo ?? null,
    contacto: { nombre: venta.cliente_nombre ?? null, telefono: venta.cliente_telefono ?? null },
  }
}

async function parteDeOrden(fila: FilaVistaNC, lector: LectorNC): Promise<ParteMotor | null> {
  // La orden se lee dentro del alcance del lector (sucursal, o asignada a él si es técnico): fuera
  // de él es lo mismo que una orden que no existe (XC-2).
  const cargada = await cargarOrdenEnAlcance(
    fila.origen_id,
    { organizationId: lector.organizationId, userId: lector.userId, role: lector.role ?? "", sucursalId: lector.userSucursalId },
    "ver",
    {
      select: `id, tecnico_id, telefono_contacto, costo_final, descuento_cobro, total_cobrado, ${NOTAS_CREDITO_APLICADO_EMBED}`,
    },
  )
  if ("error" in cargada) return null
  const orden = cargada.orden
  if (lector.role === "TECNICO" && orden.tecnico_id !== lector.userId) return null

  const { data: nc, error: ncError } = await supabaseAdmin
    .from("notas_credito")
    .select("anulada_at, anulada_motivo, items_nota_credito (descripcion, cantidad, precio_unitario)")
    .eq("id", fila.id)
    .eq("organization_id", lector.organizationId)
    .maybeSingle()
  if (ncError) throw ncError
  if (!nc) return null

  // pendienteOrden es la fuente única (PR1e); crudo, así que se redondea y se
  // recorta en 0 acá, como hacen sus otros consumidores.
  const pendienteActual =
    orden.costo_final == null
      ? null
      : Math.max(
          Math.round(
            pendienteOrden({
              costoFinal: Number(orden.costo_final) || 0,
              descuentoCobro: Number(orden.descuento_cobro) || 0,
              totalCobrado: Number(orden.total_cobrado) || 0,
              aplicadoNotasCredito: aplicadoNotasCreditoDeOrden(orden),
            }) * 100
          ) / 100,
          0
        )

  return {
    observaciones: null,
    items: ((nc.items_nota_credito ?? []) as Array<{
      descripcion: string
      cantidad: number
      precio_unitario: string | number
    }>).map((i) => {
      const cantidad = Number(i.cantidad) || 0
      const precioUnitario = dinero(i.precio_unitario)
      return { descripcion: i.descripcion, cantidad, precioUnitario, subtotal: dinero(cantidad * precioUnitario) }
    }),
    pendienteActual,
    anuladaAt: nc.anulada_at ?? null,
    anuladaMotivo: nc.anulada_motivo ?? null,
    contacto: { nombre: null, telefono: orden.telefono_contacto ?? null },
  }
}

async function clienteDe(
  clienteId: string | null,
  organizationId: string,
  contacto: ParteMotor["contacto"]
): Promise<ClienteDocumentoNC> {
  if (clienteId) {
    const { data, error } = await supabaseAdmin
      .from("clientes")
      .select("nombre, dni, telefono, email, direccion")
      .eq("id", clienteId)
      .eq("organization_id", organizationId)
      .maybeSingle()
    if (error) throw error
    if (data) {
      return {
        nombre: data.nombre || contacto.nombre || CONSUMIDOR_FINAL,
        dni: data.dni ?? null,
        telefono: contacto.telefono || data.telefono || null,
        email: data.email ?? null,
        direccion: data.direccion ?? null,
      }
    }
  }
  return { nombre: contacto.nombre || CONSUMIDOR_FINAL, dni: null, telefono: contacto.telefono, email: null, direccion: null }
}

// Emisor en dos escalones: las columnas fiscales de la migración 295 pueden no estar aplicadas
// todavía y el documento tiene que salir igual (mismo patrón que el recibo de cuenta corriente).
const ORG_COLS = "nombre, nombre_mostrar, telefono, direccion, logo_url, moneda, zona_horaria, pais"
const ORG_COLS_FISCAL = `${ORG_COLS}, cuit, condicion_iva, domicilio_fiscal`

async function emisorDe(organizationId: string): Promise<EmisorDocumentoNC> {
  let { data, error } = await supabaseAdmin
    .from("organizations")
    .select(ORG_COLS_FISCAL)
    .eq("id", organizationId)
    .single()
  if (error && isMissingColumnError(error)) {
    ;({ data, error } = (await supabaseAdmin
      .from("organizations")
      .select(ORG_COLS)
      .eq("id", organizationId)
      .single()) as { data: typeof data; error: typeof error })
  }
  if (error) throw error
  const o = (data ?? {}) as Record<string, string | null | undefined>
  return {
    nombreEmpresa: o.nombre_mostrar || o.nombre || null,
    telefonoEmpresa: o.telefono ?? null,
    direccionEmpresa: o.direccion ?? null,
    domicilioFiscalEmpresa: o.domicilio_fiscal ?? null,
    cuitEmpresa: o.cuit ?? null,
    condicionIvaEmpresa: o.condicion_iva ?? null,
    pais: o.pais ?? null,
    logoUrl: o.logo_url ?? null,
    moneda: o.moneda ?? null,
    zonaHoraria: o.zona_horaria || DEFAULT_TIMEZONE,
  }
}

/** Nombre de una sucursal o de un usuario: decoración, una falla no frena el documento. */
async function nombreDe(tabla: "sucursales" | "users", id: string | null, organizationId: string): Promise<string | null> {
  if (!id) return null
  try {
    const { data, error } = await supabaseAdmin
      .from(tabla)
      .select("nombre")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle()
    if (error) return null
    return (data?.nombre as string | null | undefined) ?? null
  } catch {
    return null
  }
}

export async function cargarDocumentoNC(id: string, lector: LectorNC): Promise<NotaCreditoDocumento | null> {
  const { data, error } = await supabaseAdmin
    .from("v_notas_credito")
    .select(COLUMNAS_VISTA_NC)
    .eq("id", id)
    .eq("organization_id", lector.organizationId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const fila = data as unknown as FilaVistaNC

  const parte = fila.origen === "VENTA" ? await parteDeVenta(fila, lector) : await parteDeOrden(fila, lector)
  if (!parte) return null

  const [cliente, emisor, sucursalNombre, atendidoPor] = await Promise.all([
    clienteDe(fila.cliente_id, lector.organizationId, parte.contacto),
    emisorDe(lector.organizationId),
    nombreDe("sucursales", fila.sucursal_id, lector.organizationId),
    nombreDe("users", fila.user_id, lector.organizationId),
  ])

  return {
    id: fila.id,
    origen: fila.origen,
    origenId: fila.origen_id,
    origenNumero: numeroOperacion(fila.origen, fila.origen_numero),
    numero: fila.numero,
    fecha: fila.fecha,
    modo: fila.modo,
    motivoNc: esMotivoNC(fila.motivo_nc) ? fila.motivo_nc : null,
    detalle: fila.detalle,
    observaciones: parte.observaciones,
    items: parte.items,
    monto: dinero(fila.monto),
    montoAplicadoDeuda: dinero(fila.monto_aplicado_deuda),
    montoReembolso: dinero(fila.monto_reembolso),
    metodo: fila.metodo,
    pendienteActual: parte.pendienteActual,
    anulada: fila.anulada === true,
    anuladaAt: parte.anuladaAt,
    anuladaMotivo: parte.anuladaMotivo,
    cliente,
    sucursalNombre,
    atendidoPor,
    emisor,
  }
}
