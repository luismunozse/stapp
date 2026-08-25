/**
 * Utilidades para exportación de datos a CSV y XLSX
 * Feature Premium: Solo usuarios con plan Premium pueden exportar
 */

import ExcelJS from "exceljs"

export interface CSVColumn<T> {
  key: keyof T | string
  header: string
  transform?: (value: any, row: T) => string
}

/**
 * Convierte un array de objetos a formato CSV
 */
export function arrayToCSV<T extends Record<string, any>>(
  data: T[],
  columns: CSVColumn<T>[]
): string {
  if (data.length === 0) {
    return columns.map((col) => col.header).join(",")
  }

  // Header row
  const header = columns.map((col) => escapeCSVField(col.header)).join(",")

  // Data rows
  const rows = data.map((row) => {
    return columns
      .map((col) => {
        const keys = col.key.toString().split(".")
        let value: any = row
        for (const key of keys) {
          value = value?.[key]
        }

        if (col.transform) {
          value = col.transform(value, row)
        }

        return escapeCSVField(formatValue(value))
      })
      .join(",")
  })

  return [header, ...rows].join("\n")
}

/**
 * Escapa un campo para CSV (maneja comas, comillas, saltos de línea)
 */
function escapeCSVField(field: string): string {
  // Mitiga CSV/formula injection: un valor que arranca con =,+,-,@ (o tab/CR)
  // es ejecutado como fórmula por Excel/Sheets. Lo prefijamos con comilla simple.
  let safe = field
  if (/^[=+\-@\t\r]/.test(safe)) {
    safe = "'" + safe
  }
  if (safe.includes(",") || safe.includes('"') || safe.includes("\n")) {
    return `"${safe.replace(/"/g, '""')}"`
  }
  return safe
}

/**
 * Formatea valores para CSV
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return ""
  }
  if (value instanceof Date) {
    return value.toISOString().split("T")[0]
  }
  if (typeof value === "number") {
    return value.toString()
  }
  if (typeof value === "boolean") {
    return value ? "Sí" : "No"
  }
  return String(value)
}

/**
 * Formatea fecha para CSV (YYYY-MM-DD)
 */
export function formatDateCSV(date: string | Date | null): string {
  if (!date) return ""
  const d = new Date(date)
  return d.toISOString().split("T")[0]
}

/**
 * Formatea moneda para CSV
 */
export function formatCurrencyCSV(amount: number | null): string {
  if (amount === null || amount === undefined) return "0"
  return amount.toFixed(2)
}

// ============================================
// Configuraciones de columnas por entidad
// ============================================

export const ORDENES_COLUMNS: CSVColumn<any>[] = [
  { key: "numero_orden", header: "Número Orden" },
  { key: "codigo_orden", header: "Código" },
  { key: "cliente.nombre", header: "Cliente" },
  { key: "cliente.telefono", header: "Teléfono Cliente" },
  { key: "dispositivo", header: "Dispositivo" },
  { key: "tipo_dispositivo", header: "Tipo" },
  { key: "marca", header: "Marca" },
  { key: "estado", header: "Estado" },
  {
    key: "fecha_ingreso",
    header: "Fecha Ingreso",
    transform: (v) => formatDateCSV(v),
  },
  {
    key: "fecha_prometida",
    header: "Fecha Prometida",
    transform: (v) => formatDateCSV(v),
  },
  {
    key: "fecha_completado",
    header: "Fecha Completado",
    transform: (v) => formatDateCSV(v),
  },
  {
    key: "presupuesto",
    header: "Presupuesto",
    transform: (v) => formatCurrencyCSV(v),
  },
  {
    key: "costo_final",
    header: "Costo Final",
    transform: (v) => formatCurrencyCSV(v),
  },
  { key: "tecnico.nombre", header: "Técnico" },
  { key: "problema_reportado", header: "Problema Reportado" },
  { key: "diagnostico", header: "Diagnóstico" },
]

export const VENTAS_COLUMNS: CSVColumn<any>[] = [
  { key: "numero_venta", header: "Número Venta" },
  {
    key: "created_at",
    header: "Fecha",
    transform: (v) => formatDateCSV(v),
  },
  { key: "cliente_nombre", header: "Cliente" },
  { key: "cliente_telefono", header: "Teléfono" },
  {
    key: "subtotal",
    header: "Subtotal",
    transform: (v) => formatCurrencyCSV(v),
  },
  {
    key: "descuento",
    header: "Descuento",
    transform: (v) => formatCurrencyCSV(v),
  },
  {
    key: "total",
    header: "Total",
    transform: (v) => formatCurrencyCSV(v),
  },
  { key: "metodo_pago", header: "Método Pago" },
  { key: "estado", header: "Estado" },
  { key: "vendedor.nombre", header: "Vendedor" },
  { key: "observaciones", header: "Observaciones" },
]

export const CLIENTES_COLUMNS: CSVColumn<any>[] = [
  { key: "nombre", header: "Nombre" },
  { key: "telefono", header: "Teléfono" },
  { key: "email", header: "Email" },
  { key: "direccion", header: "Dirección" },
  { key: "dni", header: "DNI" },
  {
    key: "created_at",
    header: "Fecha Registro",
    transform: (v) => formatDateCSV(v),
  },
]

export const INVENTARIO_COLUMNS: CSVColumn<any>[] = [
  { key: "codigo", header: "Código" },
  { key: "nombre", header: "Nombre" },
  { key: "descripcion", header: "Descripción" },
  { key: "categoria", header: "Categoría" },
  { key: "tipo_dispositivo", header: "Tipo Dispositivo" },
  { key: "stock", header: "Stock" },
  {
    key: "precio_compra",
    header: "Precio Compra",
    transform: (v) => formatCurrencyCSV(v),
  },
  {
    key: "precio_venta",
    header: "Precio Venta",
    transform: (v) => formatCurrencyCSV(v),
  },
  { key: "proveedor", header: "Proveedor" },
]

// Columnas de INVENTARIO_COLUMNS que exponen costo de compra. El costo sigue
// hasInventarioAccess como el resto del inventario (ADMIN siempre, VENDEDOR
// solo con el opt-in de la org, TECNICO nunca).
const INVENTARIO_COST_KEYS: string[] = ["precio_compra"]

/**
 * Columnas de inventario para exportar, según si el rol puede ver el costo.
 *
 * El costo se declara acá y no en la ruta, que es justamente por qué el
 * barrido endpoint por endpoint no lo vio. Cualquier export nuevo de
 * inventario tiene que pasar por este helper en vez de usar
 * INVENTARIO_COLUMNS directo.
 *
 * Sin acceso se cae la columna en vez de rechazar el export entero: la
 * portabilidad de datos no está gateada por rol ni por plan.
 */
export function inventarioColumns(includeCost: boolean): CSVColumn<any>[] {
  if (includeCost) return INVENTARIO_COLUMNS
  return INVENTARIO_COLUMNS.filter(
    (col) => !INVENTARIO_COST_KEYS.includes(col.key.toString())
  )
}

/**
 * Cantidad sugerida a pedir para reponer un item.
 *
 * Espeja el target_stock del RPC de reposición (migración 171) sin su parte de
 * demanda: acá el usuario eligió los items a mano, así que no hay ventana de
 * ventas que consultar ni items que descartar por no necesitar reposición.
 *
 * umbral = punto_reorden ?? stock_minimo ?? umbral de la org
 * target = max(stock_maximo, umbral * 2)
 *
 * Da 0 cuando el stock ya cubre el target: es una sugerencia editable en la
 * planilla, no una cantidad inventada para que la fila no quede vacía.
 */
export function calcularCantidadPedido(
  item: {
    stock?: number | null
    stock_minimo?: number | null
    punto_reorden?: number | null
    stock_maximo?: number | null
  },
  umbralOrg: number
): number {
  const stock = item.stock ?? 0
  const umbral = item.punto_reorden ?? item.stock_minimo ?? umbralOrg
  const target = Math.max(item.stock_maximo ?? 0, umbral * 2)
  return Math.max(target - stock, 0)
}

// Columnas de PEDIDO que exponen costo de compra, con el mismo criterio que
// INVENTARIO_COST_KEYS. El subtotal es cantidad * precio_compra, así que
// filtrar solo el precio dejaría el costo deducible.
const PEDIDO_COST_KEYS: string[] = ["precio_compra", "subtotal"]

/**
 * Columnas para la planilla de pedido a proveedor.
 *
 * No es el export de inventario filtrado: se cae el precio de venta (dato
 * nuestro que no va al proveedor) y aparece "Cantidad a Pedir", precargada
 * con la sugerencia para que la planilla sirva tal cual sale.
 */
export function pedidoColumns(
  includeCost: boolean,
  umbralOrg: number
): CSVColumn<any>[] {
  const columns: CSVColumn<any>[] = [
    { key: "codigo", header: "Código" },
    { key: "nombre", header: "Nombre" },
    { key: "categoria", header: "Categoría" },
    {
      key: "proveedores.nombre",
      header: "Proveedor",
      // proveedor_id es la FK real desde la migración 105; `proveedor` quedó
      // como texto libre de los items que nunca se migraron.
      transform: (v, row) => v || row?.proveedor || "",
    },
    { key: "stock", header: "Stock Actual" },
    {
      key: "stock_minimo",
      header: "Stock Mínimo",
      transform: (v, row) => {
        const umbral = row?.punto_reorden ?? v
        return umbral === null || umbral === undefined ? "" : String(umbral)
      },
    },
    {
      key: "cantidad_pedido",
      header: "Cantidad a Pedir",
      transform: (_v, row) => String(calcularCantidadPedido(row || {}, umbralOrg)),
    },
    {
      key: "precio_compra",
      header: "Precio Compra",
      transform: (v) => formatCurrencyCSV(v),
    },
    {
      key: "subtotal",
      header: "Subtotal",
      transform: (_v, row) =>
        formatCurrencyCSV(
          calcularCantidadPedido(row || {}, umbralOrg) * (row?.precio_compra ?? 0)
        ),
    },
  ]

  if (includeCost) return columns
  return columns.filter((col) => !PEDIDO_COST_KEYS.includes(col.key.toString()))
}

export const MOVIMIENTOS_COLUMNS: CSVColumn<any>[] = [
  {
    key: "created_at",
    header: "Fecha",
    transform: (v) => formatDateCSV(v),
  },
  { key: "inventario.nombre", header: "Producto" },
  { key: "inventario.codigo", header: "Código" },
  { key: "tipo", header: "Tipo" },
  { key: "cantidad", header: "Cantidad" },
  { key: "stock_anterior", header: "Stock Anterior" },
  { key: "stock_posterior", header: "Stock Posterior" },
  { key: "referencia_tipo", header: "Referencia" },
  { key: "observaciones", header: "Observaciones" },
  { key: "usuario.nombre", header: "Usuario" },
]

export const DEVOLUCIONES_COLUMNS: CSVColumn<any>[] = [
  { key: "numero_devolucion", header: "Nro. Devolución" },
  {
    key: "created_at",
    header: "Fecha",
    transform: (v) => formatDateCSV(v),
  },
  { key: "tipo", header: "Tipo" },
  { key: "motivo", header: "Motivo" },
  {
    key: "monto_devolucion",
    header: "Monto",
    transform: (v) => formatCurrencyCSV(v),
  },
  { key: "estado", header: "Estado" },
  { key: "observaciones", header: "Observaciones" },
]

export const GARANTIAS_COLUMNS: CSVColumn<any>[] = [
  { key: "orden.numero_orden", header: "Número Orden" },
  { key: "orden.cliente.nombre", header: "Cliente" },
  { key: "orden.dispositivo", header: "Dispositivo" },
  { key: "dias_validez", header: "Días Validez" },
  {
    key: "fecha_inicio",
    header: "Fecha Inicio",
    transform: (v) => formatDateCSV(v),
  },
  {
    key: "fecha_vencimiento",
    header: "Fecha Vencimiento",
    transform: (v) => formatDateCSV(v),
  },
  { key: "estado", header: "Estado" },
  { key: "notas", header: "Notas" },
]

/**
 * Convierte un array de objetos a un workbook XLSX (Buffer).
 * Usa las mismas CSVColumn que arrayToCSV: resuelve keys con dot-path y
 * aplica transform si existe.
 */
export async function arrayToXLSX<T extends Record<string, any>>(
  data: T[],
  columns: CSVColumn<T>[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Datos")

  sheet.addRow(columns.map((col) => col.header))
  sheet.getRow(1).font = { bold: true }

  for (const row of data) {
    sheet.addRow(
      columns.map((col) => {
        const keys = col.key.toString().split(".")
        let value: any = row
        for (const key of keys) {
          value = value?.[key]
        }
        if (col.transform) {
          return formatValue(col.transform(value, row))
        }
        return formatValue(value)
      })
    )
  }

  sheet.columns.forEach((column, i) => {
    column.width = Math.max(columns[i].header.length + 2, 14)
  })

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Descarga un Blob en el navegador, o lo guarda al filesystem en Capacitor.
 * Maneja contenido binario (xlsx) y de texto (csv).
 */
export async function triggerDownload(blob: Blob, filename: string): Promise<void> {
  const { Capacitor } = await import("@capacitor/core")
  if (Capacitor.isNativePlatform()) {
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem")
      const base64 = await blobToBase64(blob)
      await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Documents,
      })
      alert(`Archivo guardado en Documentos: ${filename}`)
    } catch (error) {
      console.error("Error guardando archivo nativo:", error)
      alert("Error al guardar el archivo")
    }
    return
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.setAttribute("href", url)
  link.setAttribute("download", filename)
  link.style.visibility = "hidden"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      resolve(result.split(",")[1] || "")
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Descarga texto CSV (UTF-8 con BOM para Excel) usando triggerDownload.
 */
export async function downloadCSV(csvContent: string, filename: string): Promise<void> {
  const blob = new Blob(["\ufeff" + csvContent], {
    type: "text/csv;charset=utf-8;",
  })
  await triggerDownload(blob, filename)
}
