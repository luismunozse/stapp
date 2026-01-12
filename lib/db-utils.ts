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
    clienteId: orden.cliente_id,
    tecnicoId: orden.tecnico_id,
    organizationId: orden.organization_id,
    dispositivo: orden.dispositivo,
    tipoDispositivo: orden.tipo_dispositivo,
    // Nuevos campos de dispositivo
    marca: orden.marca,
    color: orden.color,
    imei: orden.imei,
    accesorios: orden.accesorios,
    passwordDispositivo: orden.password_dispositivo,
    // Campos existentes
    problemaReportado: orden.problema_reportado,
    estado: orden.estado,
    presupuesto: orden.presupuesto,
    costoFinal: orden.costo_final,
    sena: orden.sena || 0,
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

  return {
    id: item.id,
    codigo: item.codigo,
    nombre: item.nombre,
    descripcion: item.descripcion,
    categoria: item.categoria,
    tipoDispositivo: item.tipo_dispositivo,
    stock: item.stock,
    precioCompra: item.precio_compra,
    precioVenta: item.precio_venta,
    proveedor: item.proveedor,
    organizationId: item.organization_id,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
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
