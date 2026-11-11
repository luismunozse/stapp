/**
 * Un taller con una garantía de reparación y una de venta, y la vista
 * v_garantias calculada sobre las tablas (como la 401): el reclamo abierto de
 * cada garantía sale de reclamos_garantia. Los hooks hacen de los triggers de
 * la 401 (organization_id desde la garantía) y de su índice único parcial (un
 * reclamo abierto por garantía).
 */
import { instalarBaseReactiva } from "../helpers/supabase-reactiva"

type Row = Record<string, any>

export const ORG = "org-1"
export const S1 = "suc-1"
export const S2 = "suc-2"
export const TEC_ORIGINAL = "tec-original"

const ABIERTOS = ["PENDIENTE", "EN_REVISION", "ACEPTADO"]

/** Un día "YYYY-MM-DD" relativo a hoy (UTC; la org del fixture está en UTC). */
export function dia(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
}

export interface OpcionesFixture {
  /** Días hasta el vencimiento de la garantía de reparación (negativo = vencida). */
  vencimientoReparacion?: number
  vencimientoVenta?: number
  ventaConCliente?: boolean
  ventaAnulada?: boolean
  sinGarantiaReparacion?: boolean
  reclamos?: Row[]
  /** La orden original sin sucursal (órdenes viejas): el re-ingreso va a la principal. */
  ordenSinSucursal?: boolean
  /** El índice único rechaza el próximo reclamo (otro request lo insertó en paralelo). */
  carrera?: boolean
}

export function montarTaller(o: OpcionesFixture = {}) {
  const tablas: Record<string, Row[]> = {
    organizations: [{ id: ORG, zona_horaria: "UTC", pais: "AR", nombre: "Taller", nombre_mostrar: null, slug: "taller", moneda: "ARS" }],
    sucursales: [
      { id: S1, organization_id: ORG, nombre: "Centro", principal: true, deleted_at: null },
      { id: S2, organization_id: ORG, nombre: "Norte", principal: false, deleted_at: null },
    ],
    clientes: [
      { id: "cli-1", organization_id: ORG, nombre: "Juan Pérez", telefono: "1155550000", email: "juan@example.com" },
      { id: "cli-2", organization_id: ORG, nombre: "Ana Gómez", telefono: "1155551111", email: null },
    ],
    users: [
      { id: "admin-1", organization_id: ORG, nombre: "Admin" },
      { id: "vend-1", organization_id: ORG, nombre: "Vendedora" },
      { id: TEC_ORIGINAL, organization_id: ORG, nombre: "Técnico original" },
    ],
    ordenes_servicio: [
      {
        id: "ord-1",
        organization_id: ORG,
        numero_orden: 10,
        codigo_orden: "CEL010",
        cliente_id: "cli-1",
        dispositivo: "iPhone 13",
        tipo_dispositivo: "CELULAR",
        marca: "Apple",
        color: "Negro",
        imei: "123",
        accesorios: null,
        password_dispositivo: null,
        metadata: {},
        sector_id: null,
        sucursal_id: o.ordenSinSucursal ? null : S1,
        tecnico_id: TEC_ORIGINAL,
        estado: "ENTREGADO",
        es_practica: false,
        es_reingreso: false,
      },
    ],
    garantias: o.sinGarantiaReparacion
      ? []
      : [
          {
            id: "gar-1",
            orden_id: "ord-1",
            organization_id: ORG,
            dias_validez: 90,
            fecha_inicio: `${dia(-10)}T12:00:00Z`,
            fecha_vencimiento: `${dia(o.vencimientoReparacion ?? 30)}T12:00:00Z`,
            estado: "ACTIVA",
          },
        ],
    ventas: [
      {
        id: "ven-1",
        organization_id: ORG,
        numero_venta: 12,
        cliente_id: o.ventaConCliente === false ? null : "cli-2",
        cliente_nombre: "Ana Gómez",
        cliente_telefono: "1155551111",
        vendedor_id: "vend-1",
        sucursal_id: S1,
        estado: o.ventaAnulada ? "ANULADA" : "COMPLETADA",
      },
    ],
    items_venta: [{ id: "item-1", venta_id: "ven-1", descripcion: "Auriculares BT", inventario_id: "inv-1" }],
    inventario: [{ id: "inv-1", organization_id: ORG, tipo_dispositivo: "AUDIO" }],
    garantias_venta: [
      {
        id: "gv-1",
        venta_id: "ven-1",
        item_venta_id: "item-1",
        organization_id: ORG,
        numero_garantia: "GV-0001",
        dias_validez: 180,
        fecha_inicio: `${dia(-5)}T12:00:00Z`,
        fecha_vencimiento: `${dia(o.vencimientoVenta ?? 100)}T12:00:00Z`,
        estado: "ACTIVA",
      },
    ],
    reclamos_garantia: (o.reclamos ?? []).map((r) => ({ organization_id: ORG, fecha_reclamo: new Date().toISOString(), ...r })),
    orden_eventos: [],
  }

  const reclamoAbierto = (t: Record<string, Row[]>, col: string, id: string) =>
    (t.reclamos_garantia ?? [])
      .filter((r) => r[col] === id && ABIERTOS.includes(r.estado))
      .sort((a, b) => String(b.fecha_reclamo).localeCompare(String(a.fecha_reclamo)))[0]

  const numeroOrden = (t: Record<string, Row[]>, id: string | null | undefined) => {
    const o2 = id ? t.ordenes_servicio.find((x) => x.id === id) : null
    return o2 ? o2.codigo_orden ?? `#${o2.numero_orden}` : null
  }

  const vista = (t: Record<string, Row[]>): Row[] => {
    const filas: Row[] = []
    for (const g of t.garantias ?? []) {
      const ord = t.ordenes_servicio.find((x) => x.id === g.orden_id)
      if (!ord || ord.es_practica) continue
      const cli = t.clientes.find((c) => c.id === ord.cliente_id)
      const ra = reclamoAbierto(t, "garantia_id", g.id)
      filas.push({
        id: g.id,
        origen: "REPARACION",
        organization_id: g.organization_id,
        sucursal_id: ord.sucursal_id,
        tecnico_id: ord.tecnico_id,
        vendedor_id: null,
        cliente_id: ord.cliente_id,
        cliente_nombre: cli?.nombre ?? null,
        cliente_telefono: cli?.telefono ?? null,
        descripcion: ord.dispositivo,
        orden_id: ord.id,
        numero_orden: ord.numero_orden,
        codigo_orden: ord.codigo_orden,
        orden_estado: ord.estado,
        venta_id: null,
        numero_venta: null,
        numero_garantia: null,
        referencia: ord.codigo_orden,
        dias_validez: g.dias_validez,
        fecha_inicio: g.fecha_inicio,
        fecha_vencimiento: g.fecha_vencimiento,
        dia_vencimiento: String(g.fecha_vencimiento).slice(0, 10),
        estado_guardado: g.estado,
        anulada: false,
        tiene_reclamo_abierto: !!ra,
        reclamo_id: ra?.id ?? null,
        reclamo_estado: ra?.estado ?? null,
        reclamo_descripcion: ra?.descripcion ?? null,
        reclamo_fecha: ra?.fecha_reclamo ?? null,
        reclamo_orden_reingreso_id: ra?.orden_reingreso_id ?? null,
        reclamo_orden_reingreso_numero: numeroOrden(t, ra?.orden_reingreso_id),
      })
    }
    for (const gv of t.garantias_venta ?? []) {
      const v = t.ventas.find((x) => x.id === gv.venta_id)
      const iv = t.items_venta.find((x) => x.id === gv.item_venta_id)
      if (!v || !iv) continue
      const cli = t.clientes.find((c) => c.id === v.cliente_id)
      const ra = reclamoAbierto(t, "garantia_venta_id", gv.id)
      filas.push({
        id: gv.id,
        origen: "VENTA",
        organization_id: gv.organization_id,
        sucursal_id: v.sucursal_id,
        tecnico_id: null,
        vendedor_id: v.vendedor_id,
        cliente_id: v.cliente_id,
        cliente_nombre: cli?.nombre ?? v.cliente_nombre,
        cliente_telefono: cli?.telefono ?? v.cliente_telefono,
        descripcion: iv.descripcion,
        orden_id: null,
        numero_orden: null,
        codigo_orden: null,
        orden_estado: null,
        venta_id: v.id,
        numero_venta: v.numero_venta,
        numero_garantia: gv.numero_garantia,
        referencia: String(v.numero_venta),
        dias_validez: gv.dias_validez,
        fecha_inicio: gv.fecha_inicio,
        fecha_vencimiento: gv.fecha_vencimiento,
        dia_vencimiento: String(gv.fecha_vencimiento).slice(0, 10),
        estado_guardado: gv.estado,
        anulada: gv.estado === "ANULADA" || v.estado === "ANULADA",
        tiene_reclamo_abierto: !!ra,
        reclamo_id: ra?.id ?? null,
        reclamo_estado: ra?.estado ?? null,
        reclamo_descripcion: ra?.descripcion ?? null,
        reclamo_fecha: ra?.fecha_reclamo ?? null,
        reclamo_orden_reingreso_id: ra?.orden_reingreso_id ?? null,
        reclamo_orden_reingreso_numero: numeroOrden(t, ra?.orden_reingreso_id),
      })
    }
    return filas
  }

  return instalarBaseReactiva(tablas, {
    vistas: { v_garantias: vista },
    antesDeInsertar: (tabla, fila, t) => {
      if (tabla !== "reclamos_garantia") return
      // Trigger reclamos_garantia_normalizar: la org es la de la garantía.
      const g = fila.garantia_id
        ? t.garantias.find((x) => x.id === fila.garantia_id)
        : t.garantias_venta.find((x) => x.id === fila.garantia_venta_id)
      fila.organization_id = g?.organization_id ?? null
      fila.fecha_reclamo ??= new Date().toISOString()
      if (o.carrera) return { code: "23505", message: "duplicate key value violates unique constraint" }
      // Índice único parcial: un reclamo abierto por garantía.
      const col = fila.garantia_id ? "garantia_id" : "garantia_venta_id"
      if (ABIERTOS.includes(fila.estado) && reclamoAbierto(t, col, fila[col])) {
        return { code: "23505", message: "duplicate key value violates unique constraint" }
      }
    },
  })
}
