/**
 * Utilidades para transformación de datos entre DB (snake_case) y Frontend (camelCase)
 */

// Convertir snake_case a camelCase
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

// Convertir camelCase a snake_case
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
}

// Transformar objeto de snake_case a camelCase
export function transformToCamelCase<T extends Record<string, any>>(obj: T): any {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(transformToCamelCase)
  if (typeof obj !== "object") return obj

  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = snakeToCamel(key)
    result[camelKey] = typeof value === "object" ? transformToCamelCase(value) : value
  }
  return result
}

// Transformar objeto de camelCase a snake_case
export function transformToSnakeCase<T extends Record<string, any>>(obj: T): any {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(transformToSnakeCase)
  if (typeof obj !== "object") return obj

  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = camelToSnake(key)
    result[snakeKey] = typeof value === "object" ? transformToSnakeCase(value) : value
  }
  return result
}

// PostgREST returns a reverse embed over a UNIQUE FK (one-to-one relationship
// detection, e.g. `facturas (id)` embedded via `facturas.venta_id`/`orden_id`)
// as a single object instead of an array. Normalize either shape to an array
// so callers can safely use `.length` / `[0]` regardless of which shape came
// back.
export function toArray<T>(value: T | T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : value ? [value] : []
}

export interface FormatOrdenOptions {
  /** Purchase cost the order carries over from inventario: every repuesto's
   *  `precioUnitario` is the `precio_compra` frozen when the part was loaded.
   *  Gate it with `hasInventarioAccess`. Defaults to true so existing callers
   *  that never expose the repuestos embed keep their behavior. */
  includeInventarioCost?: boolean
  /** Cost aggregate derived from the linked cotización items' `precio_compra`
   *  (`costoRepuestosCotizaciones`). Gate it with `canViewCotizacionCosts`. */
  includeCotizacionCost?: boolean
}

// Mapeo específico para órdenes (incluye relaciones)
export function formatOrden(orden: any, options: FormatOrdenOptions = {}) {
  if (!orden) return null

  const { includeInventarioCost = true, includeCotizacionCost = true } = options

  // Costo de repuestos provenientes de cotizaciones ACEPTADAS linkeadas a inventario.
  // Se suma como prop separada para que la card de comisión lo agregue al costo
  // que ya calcula desde repuestos_orden. El admin es responsable de no duplicar
  // (usar tab Repuestos O cotización aceptada, no ambos para el mismo ítem).
  //
  // Este agregado se deriva de items_cotizacion[].inventario.precio_compra, así
  // que es costo: con un solo ítem equivale a precio_compra × cantidad. Va
  // detrás del mismo permiso que los campos de los que sale, no se devuelve
  // como 0 (un cero sería indistinguible de "no hay cotización aceptada").
  const cotizacionesActivas = (orden.cotizaciones || []).filter(
    (c: any) => !c.deleted_at && c.estado === "ACEPTADA"
  )
  const costoRepuestosCotizaciones = includeCotizacionCost
    ? cotizacionesActivas.reduce((sum: number, c: any) => {
        const itemsCosto = (c.items_cotizacion || []).reduce((acc: number, it: any) => {
          const precioCompra = Number(it.inventario?.precio_compra) || 0
          const cantidad = Number(it.cantidad) || 0
          return acc + precioCompra * cantidad
        }, 0)
        return sum + itemsCosto
      }, 0)
    : null

  return {
    costoRepuestosCotizaciones,
    id: orden.id,
    numeroOrden: orden.numero_orden,
    codigoOrden: orden.codigo_orden,
    clienteId: orden.cliente_id,
    tecnicoId: orden.tecnico_id,
    organizationId: orden.organization_id,
    dispositivo: orden.dispositivo,
    tipoDispositivo: orden.tipo_dispositivo,
    // Campos de dispositivo
    marca: orden.marca,
    color: orden.color,
    imei: orden.imei,
    accesorios: orden.accesorios,
    codigoAccesoDispositivo: orden.password_dispositivo,
    telefonoContacto: orden.telefono_contacto,
    // Campos existentes
    problemaReportado: orden.problema_reportado,
    estado: orden.estado,
    motivoSinCobro: orden.motivo_sin_cobro || null,
    presupuesto: orden.presupuesto,
    costoFinal: orden.costo_final,
    sena: orden.sena || 0,
    metodoPagoSena: orden.metodo_pago_sena || "EFECTIVO",
    totalCobrado: parseFloat(orden.total_cobrado || "0"),
    estadoCobro: orden.estado_cobro || "PENDIENTE",
    descuentoCobro: parseFloat(orden.descuento_cobro || "0"),
    fechaIngreso: orden.fecha_ingreso,
    fechaPrometida: orden.fecha_prometida,
    fechaCompletado: orden.fecha_completado,
    fechaEntrega: orden.fecha_entrega,
    porcentajeComision: orden.porcentaje_comision != null ? Number(orden.porcentaje_comision) : null,
    comisionPagada: !!orden.comision_pagada,
    fechaPagoComision: orden.fecha_pago_comision || null,
    horasTrabajadas: Number(orden.horas_trabajadas ?? 0),
    costoManoObra: Number(orden.costo_mano_obra ?? 0),
    observaciones: orden.observaciones,
    notasInternas: orden.notas_internas,
    diagnostico: orden.diagnostico,
    // Relaciones
    cliente: orden.clientes ? formatCliente(orden.clientes) : undefined,
    tecnico: orden.users ? {
      id: orden.users.id,
      nombre: orden.users.nombre,
    } : undefined,
    recibidoPor: orden.recibido ? {
      id: orden.recibido.id,
      nombre: orden.recibido.nombre,
    } : null,
    fotos: orden.fotos_orden?.map(formatFoto),
    repuestos: orden.repuestos_orden?.map((r: any) => formatRepuesto(r, includeInventarioCost)),
    servicios: orden.servicios_orden?.map(formatServicioOrden),
    facturas: orden.facturas,
    cotizaciones: orden.cotizaciones,
    garantia: orden.garantias,
    checklist: orden.checklist_recepcion,
    publicToken: orden.public_token || null,
    publicTokenExpiresAt: orden.public_token_expires_at || null,
    // Re-ingreso
    ordenOrigenId: orden.orden_origen_id || null,
    esReingreso: orden.es_reingreso || false,
    garantiaOrigenId: orden.garantia_origen_id || null,
    // Recepcion multiple (lote mayorista): presente solo si la orden se creo
    // como parte de un lote. recepciones viene del join recepcion_id -> recepciones
    // en app/api/ordenes/[id]/route.ts; ausente en el select de listado (GET /api/ordenes).
    recepcionId: orden.recepcion_id || null,
    recepcionCodigo: orden.recepciones?.codigo || null,
    metadata: orden.metadata || {},
    sectorId: orden.sector_id,
    sector: orden.sectores_cliente ? {
      id: orden.sectores_cliente.id,
      clienteId: orden.sectores_cliente.cliente_id,
      nombre: orden.sectores_cliente.nombre,
      contactoNombre: orden.sectores_cliente.contacto_nombre,
      contactoTelefono: orden.sectores_cliente.contacto_telefono,
      contactoEmail: orden.sectores_cliente.contacto_email,
      activo: orden.sectores_cliente.activo,
    } : undefined,
  }
}

export function formatCliente(cliente: any) {
  if (!cliente) return null

  return {
    id: cliente.id,
    nombre: cliente.nombre,
    telefono: cliente.telefono,
    email: cliente.email,
    direccion: cliente.direccion,
    dni: cliente.dni,
    tipoCliente: cliente.tipo_cliente || "INDIVIDUAL",
    razonSocial: cliente.razon_social,
    cuit: cliente.cuit,
    aceptaWhatsapp: cliente.acepta_whatsapp ?? true,
    tipoPrecio: cliente.tipo_precio || "MINORISTA",
    descuentoPct: cliente.descuento_pct != null ? Number(cliente.descuento_pct) : null,
    saldoCuenta: parseFloat(cliente.saldo_cuenta || "0"),
    organizationId: cliente.organization_id,
    createdAt: cliente.created_at,
    updatedAt: cliente.updated_at,
  }
}

export function formatFoto(foto: any) {
  if (!foto) return null

  return {
    id: foto.id,
    ordenId: foto.orden_id,
    url: foto.url,
    storagePath: foto.storage_path,
    mime: foto.mime,
    size: foto.size,
    descripcion: foto.descripcion,
    tipo: foto.tipo,
    createdAt: foto.created_at,
  }
}

/** `includeCost` defaults to true so callers that do not expose the repuesto to
 *  a gated role keep their behavior. Pass `hasInventarioAccess(...)` on any
 *  route whose response reaches a non-inventario role. */
export function formatRepuesto(repuesto: any, includeCost = true) {
  if (!repuesto) return null

  return {
    id: repuesto.id,
    ordenId: repuesto.orden_id,
    inventarioId: repuesto.inventario_id,
    nombre: repuesto.nombre, // Para repuestos manuales
    cantidad: repuesto.cantidad,
    // precioUnitario es el COSTO (precio_compra congelado al cargar el
    // repuesto); precioVentaUnitario es lo que se le cobra al cliente.
    // Este último es NULL en filas anteriores a la migración 286.
    precioUnitario: includeCost ? repuesto.precio_unitario : null,
    precioVentaUnitario: repuesto.precio_venta_unitario ?? null,
    // El embed de inventario trae el costo VIVO (precio_compra), no la copia
    // congelada: sale por el mismo permiso que precioUnitario.
    inventario: repuesto.inventario ? formatInventario(repuesto.inventario, includeCost) : undefined,
  }
}

export function formatServicioOrden(servicio: any) {
  if (!servicio) return null

  return {
    id: servicio.id,
    ordenId: servicio.orden_id,
    servicioId: servicio.servicio_id, // Nullable: null en líneas manuales
    nombre: servicio.nombre, // Snapshot, ver comentario en 300_servicios.sql
    cantidad: servicio.cantidad,
    precioUnitario: servicio.precio_unitario,
  }
}

/** Lo que se le cobra al cliente por un repuesto. Cae al costo cuando la fila
 *  es anterior a la migración 286 y no tiene precio de venta registrado.
 *
 *  Devuelve null cuando no queda ningún precio utilizable: pasa en una fila
 *  vieja (sin precio de venta) leída por un rol al que se le ocultó el costo.
 *  La UI tiene que mostrar "sin precio", nunca $0: un cero ahí se lee como
 *  "gratis" y encima se sumaría a los totales. */
export function precioVentaRepuesto(repuesto: {
  precioVentaUnitario?: number | string | null
  precioUnitario?: number | string | null
}): number | null {
  const venta = repuesto.precioVentaUnitario
  if (venta !== null && venta !== undefined && venta !== "") return Number(venta)
  const costo = repuesto.precioUnitario
  if (costo !== null && costo !== undefined && costo !== "") return Number(costo)
  return null
}

/** `includeCost` es OPT-IN y arranca en false a propósito: `precio_compra` es
 *  el costo de compra, detrás de `hasInventarioAccess` (ADMIN siempre;
 *  VENDEDOR solo si la org habilitó el permiso; TECNICO nunca).
 *
 *  Con el default apagado, un caller nuevo que se olvide del gate pierde el
 *  costo — un bug visible que aparece en la primera prueba con un ADMIN — en
 *  vez de filtrarlo a un rol sin permiso, que es un bug silencioso. Es lo que
 *  hizo falta: la ruta de barcode quedó afuera de un barrido ruta por ruta
 *  justamente porque el formateador compartido lo emitía crudo.
 *
 *  Pasar `true` solo desde un caller que ya resolvió el permiso (con
 *  `hasInventarioAccess`) o que corre detrás de `requireInventarioAccess()`. */
export function formatInventario(item: any, includeCost = false) {
  if (!item) return null

  // Resolver nombre del proveedor: si viene el join (proveedores), usarlo.
  // Si no, caer al texto libre legacy (columna `proveedor`).
  const proveedorJoin = item.proveedores || item.proveedor_rel
  const proveedorNombre = proveedorJoin?.nombre ?? item.proveedor ?? null

  return {
    id: item.id,
    codigo: item.codigo,
    nombre: item.nombre,
    descripcion: item.descripcion,
    categoria: item.categoria,
    tipoDispositivo: item.tipo_dispositivo,
    stock: item.stock,
    stockReservado: item.stock_reservado ?? 0,
    precioCompra: includeCost ? item.precio_compra : null,
    precioVenta: item.precio_venta,
    proveedor: proveedorNombre,
    proveedorId: item.proveedor_id ?? null,
    imagenUrl: item.imagen_url ?? null,
    imagenPath: item.imagen_path ?? null,
    stockMinimo: item.stock_minimo ?? null,
    stockMaximo: item.stock_maximo ?? null,
    puntoReorden: item.punto_reorden ?? null,
    barcode: item.barcode ?? null,
    ubicacion: item.ubicacion ?? null,
    trackeaLotes: item.trackea_lotes ?? false,
    trackeaSeries: item.trackea_series ?? false,
    diasAlertaVencimiento: item.dias_alerta_vencimiento ?? null,
    diasGarantiaDefault: item.dias_garantia_default ?? null,
    tieneVariantes: item.tiene_variantes ?? false,
    esKit: item.es_kit ?? false,
    tipoKit: item.tipo_kit ?? null,
    deletedAt: item.deleted_at ?? null,
    deletedBy: item.deleted_by ?? null,
    organizationId: item.organization_id,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }
}

export function formatVenta(venta: any) {
  if (!venta) return null

  return {
    id: venta.id,
    numeroVenta: venta.numero_venta,
    clienteId: venta.cliente_id,
    clienteNombre: venta.cliente_nombre,
    clienteTelefono: venta.cliente_telefono,
    vendedorId: venta.vendedor_id,
    subtotal: parseFloat(venta.subtotal),
    descuento: parseFloat(venta.descuento),
    tipoDescuento: venta.tipo_descuento || "MONTO",
    porcentajeDescuento: venta.porcentaje_descuento ? parseFloat(venta.porcentaje_descuento) : 0,
    total: parseFloat(venta.total),
    montoAbonado: parseFloat(venta.monto_abonado || "0"),
    estadoPago: venta.estado_pago || "PAGADO",
    metodoPago: venta.metodo_pago,
    estado: venta.estado,
    observaciones: venta.observaciones,
    descuentoAprobadoPor: venta.descuento_aprobado_por || null,
    descuentoMotivo: venta.descuento_motivo || null,
    createdAt: venta.created_at,
    updatedAt: venta.updated_at,
    // Relaciones
    cliente: venta.clientes ? formatCliente(venta.clientes) : undefined,
    vendedor: venta.users ? { id: venta.users.id, nombre: venta.users.nombre } : undefined,
    items: venta.items_venta?.map(formatItemVenta) || [],
    garantias: venta.garantias_venta?.map(formatGarantiaVenta) || [],
    pagos: venta.pagos_venta?.map(formatPagoVenta)?.sort(
      (a: any, b: any) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
    ) || [],
    devoluciones: venta.devoluciones_venta?.map(formatDevolucion) || [],
    facturaId: toArray(venta.facturas)[0]?.id ?? null,
  }
}

export function formatItemVenta(item: any) {
  if (!item) return null

  return {
    id: item.id,
    inventarioId: item.inventario_id,
    // El embed `inventario (*)` de la venta trae precio_compra, pero ningún
    // consumidor de /api/ventas lee el costo del item: no se pide.
    inventario: item.inventario ? formatInventario(item.inventario) : undefined,
    descripcion: item.descripcion,
    cantidad: item.cantidad,
    precioUnitario: parseFloat(item.precio_unitario),
    subtotal: parseFloat(item.subtotal),
    diasGarantia: item.dias_garantia,
    descuento: item.descuento ? parseFloat(item.descuento) : 0,
    tipoDescuento: item.tipo_descuento || "MONTO",
    porcentajeDescuento: item.porcentaje_descuento ? parseFloat(item.porcentaje_descuento) : 0,
  }
}

export function formatGarantiaVenta(g: any) {
  if (!g) return null

  return {
    id: g.id,
    numeroGarantia: g.numero_garantia,
    itemVentaId: g.item_venta_id,
    diasValidez: g.dias_validez,
    fechaInicio: g.fecha_inicio,
    fechaVencimiento: g.fecha_vencimiento,
    estado: g.estado,
  }
}

export function formatPagoVenta(p: any) {
  if (!p) return null

  return {
    id: p.id,
    monto: parseFloat(p.monto),
    metodoPago: p.metodo_pago,
    referencia: p.numero_referencia,
    fecha: p.fecha,
    observaciones: p.observaciones,
    cuotas: p.cuotas,
    recargoPorcentaje: p.recargo_porcentaje ? parseFloat(p.recargo_porcentaje) : null,
    montoOriginal: p.monto_original ? parseFloat(p.monto_original) : null,
    costoFinancieroPorcentaje: p.costo_financiero_porcentaje ? parseFloat(p.costo_financiero_porcentaje) : null,
    costoFinancieroMonto: p.costo_financiero_monto ? parseFloat(p.costo_financiero_monto) : null,
  }
}

export function formatMovimiento(m: any) {
  if (!m) return null

  return {
    id: m.id,
    inventarioId: m.inventario_id,
    tipo: m.tipo,
    cantidad: m.cantidad,
    stockAnterior: m.stock_anterior,
    stockPosterior: m.stock_posterior,
    referenciaId: m.referencia_id,
    referenciaTipo: m.referencia_tipo,
    observaciones: m.observaciones,
    usuarioId: m.usuario_id,
    usuario: m.users ? { id: m.users.id, nombre: m.users.nombre } : undefined,
    createdAt: m.created_at,
  }
}

export function formatDevolucion(d: any) {
  if (!d) return null

  return {
    id: d.id,
    ventaId: d.venta_id,
    numeroDevolucion: d.numero_devolucion,
    motivo: d.motivo,
    tipo: d.tipo,
    montoDevolucion: parseFloat(d.monto_devolucion),
    estado: d.estado,
    observaciones: d.observaciones,
    procesadoPor: d.procesado_por,
    metodoReembolso: d.metodo_reembolso || null,
    reembolsoReferencia: d.reembolso_referencia || null,
    fechaReembolso: d.fecha_reembolso || null,
    reembolsoProcesadoPor: d.reembolso_procesado_por || null,
    createdAt: d.created_at,
    items: d.items_devolucion?.map((item: any) => ({
      id: item.id,
      itemVentaId: item.item_venta_id,
      inventarioId: item.inventario_id,
      cantidad: item.cantidad,
      precioUnitario: parseFloat(item.precio_unitario),
      subtotal: parseFloat(item.subtotal),
      restaurarStock: item.restaurar_stock,
    })) || [],
  }
}

export function formatUser(user: any) {
  if (!user) return null

  return {
    id: user.id,
    email: user.email,
    nombre: user.nombre,
    rol: user.rol,
    organizationId: user.organization_id,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  }
}

export function formatProveedor(proveedor: any) {
  if (!proveedor) return null

  return {
    id: proveedor.id,
    nombre: proveedor.nombre,
    telefono: proveedor.telefono,
    whatsapp: proveedor.whatsapp,
    email: proveedor.email,
    direccion: proveedor.direccion,
    website: proveedor.website,
    notas: proveedor.notas,
    activo: proveedor.activo,
    razonSocial: proveedor.razon_social ?? null,
    cuit: proveedor.cuit ?? null,
    condicionIva: proveedor.condicion_iva ?? null,
    ingresosBrutos: proveedor.ingresos_brutos ?? null,
    condicionPago: proveedor.condicion_pago ?? null,
    diasPago: proveedor.dias_pago ?? null,
    leadTimeDias: proveedor.lead_time_dias ?? null,
    pedidoMinimo: proveedor.pedido_minimo != null ? Number(proveedor.pedido_minimo) : null,
    rating: proveedor.rating ?? null,
    tags: proveedor.tags ?? null,
    logoUrl: proveedor.logo_url ?? null,
    logoPath: proveedor.logo_path ?? null,
    organizationId: proveedor.organization_id,
    createdAt: proveedor.created_at,
    updatedAt: proveedor.updated_at,
  }
}

export function formatProveedorContacto(c: any) {
  if (!c) return null
  return {
    id: c.id,
    proveedorId: c.proveedor_id,
    nombre: c.nombre,
    cargo: c.cargo ?? null,
    telefono: c.telefono ?? null,
    whatsapp: c.whatsapp ?? null,
    email: c.email ?? null,
    notas: c.notas ?? null,
    principal: !!c.principal,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }
}

export function formatProveedorAdjunto(a: any) {
  if (!a) return null
  return {
    id: a.id,
    proveedorId: a.proveedor_id,
    nombre: a.nombre,
    descripcion: a.descripcion ?? null,
    fileUrl: a.file_url,
    filePath: a.file_path,
    mime: a.mime ?? null,
    sizeBytes: a.size_bytes != null ? Number(a.size_bytes) : null,
    uploadedBy: a.uploaded_by ?? null,
    createdAt: a.created_at,
  }
}

/** `includeCost` es OPT-IN y arranca en false, igual que `formatInventario`:
 *  `precio_referencia` es el precio de compra al proveedor y el item viaja con
 *  `inventario_id`, así que se reduce al costo de un item de inventario exacto.
 *  Va detrás de `hasInventarioAccess`, como sus dos hermanos de la misma
 *  página (`/proveedores/[id]/stats` y `/proveedores/[id]/comparativa`).
 *
 *  Con el default apagado, un caller nuevo que se olvide del gate pierde el
 *  precio — un bug visible con un ADMIN — en vez de filtrarlo a un rol sin
 *  permiso, que es un bug silencioso. Son tres call sites, todos gateados. */
export function formatProveedorCatalogoItem(i: any, includeCost = false) {
  if (!i) return null
  return {
    id: i.id,
    proveedorId: i.proveedor_id,
    inventarioId: i.inventario_id ?? null,
    codigoProveedor: i.codigo_proveedor ?? null,
    nombre: i.nombre,
    descripcion: i.descripcion ?? null,
    precioReferencia:
      includeCost && i.precio_referencia != null ? Number(i.precio_referencia) : null,
    moneda: i.moneda ?? "ARS",
    unidad: i.unidad ?? null,
    notas: i.notas ?? null,
    precioActualizadoAt: i.precio_actualizado_at ?? null,
    inventario: i.inventario ? { id: i.inventario.id, codigo: i.inventario.codigo, nombre: i.inventario.nombre } : null,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
  }
}

export function formatImportacion(importacion: any) {
  if (!importacion) return null

  return {
    id: importacion.id,
    organizationId: importacion.organization_id,
    userId: importacion.user_id,
    entityType: importacion.entity_type,
    filename: importacion.filename,
    filePath: importacion.file_path,
    fileSize: importacion.file_size,
    totalRows: importacion.total_rows,
    successCount: importacion.success_count,
    skippedCount: importacion.skipped_count,
    errorCount: importacion.error_count,
    errorsDetail: importacion.errors_detail,
    createdAt: importacion.created_at,
    user: importacion.users ? formatUser(importacion.users) : undefined,
  }
}
