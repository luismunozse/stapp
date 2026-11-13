import { resolveTipoDispositivo } from "@/lib/csv-validator"

export function buildInventarioPayload(d: any, codigo: string, organizationId: string) {
  return {
    codigo,
    nombre: d.nombre,
    descripcion: d.descripcion || null,
    categoria: d.categoria || 'GENERAL',
    tipo_dispositivo: resolveTipoDispositivo(d.tipoDispositivo),
    stock: d.stock,
    precio_compra: d.precioCompra ?? 0,
    precio_venta: d.precioVenta,
    proveedor: d.proveedor || d.marca || null,
    moneda: null,
    organization_id: organizationId,
  }
}
