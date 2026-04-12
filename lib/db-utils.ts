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

// Mapeo específico para órdenes (incluye relaciones)
export function formatOrden(orden: any) {
  if (!orden) return null

  return {
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
    observaciones: orden.observaciones,
    diagnostico: orden.diagnostico,
    // Relaciones
    cliente: orden.clientes ? formatCliente(orden.clientes) : undefined,
    tecnico: orden.users ? {
      id: orden.users.id,
      nombre: orden.users.nombre,
    } : undefined,
    fotos: orden.fotos_orden?.map(formatFoto),
    repuestos: orden.repuestos_orden?.map(formatRepuesto),
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

export function formatRepuesto(repuesto: any) {
  if (!repuesto) return null

  return {
    id: repuesto.id,
    ordenId: repuesto.orden_id,
    inventarioId: repuesto.inventario_id,
    nombre: repuesto.nombre, // Para repuestos manuales
    cantidad: repuesto.cantidad,
    precioUnitario: repuesto.precio_unitario,
    inventario: repuesto.inventario ? formatInventario(repuesto.inventario) : undefined,
  }
}

export function formatInventario(item: any) {
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
    precioCompra: item.precio_compra,
    precioVenta: item.precio_venta,
    proveedor: proveedorNombre,
    proveedorId: item.proveedor_id ?? null,
    imagenUrl: item.imagen_url ?? null,
    imagenPath: item.imagen_path ?? null,
    stockMinimo: item.stock_minimo ?? null,
    stockMaximo: item.stock_maximo ?? null,
    puntoReorden: item.punto_reorden ?? null,
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
  }
}

export function formatItemVenta(item: any) {
  if (!item) return null

  return {
    id: item.id,
    inventarioId: item.inventario_id,
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
    organizationId: proveedor.organization_id,
    createdAt: proveedor.created_at,
    updatedAt: proveedor.updated_at,
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
