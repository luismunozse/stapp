/**
 * Utilidades para exportación de datos a CSV
 * Feature Premium: Solo usuarios con plan Premium pueden exportar
 */

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
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
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
 * Descarga un archivo CSV en el navegador o filesystem nativo
 */
export async function downloadCSV(csvContent: string, filename: string): Promise<void> {
  // En Capacitor nativo, guardar al filesystem del dispositivo
  const { Capacitor } = await import("@capacitor/core")
  if (Capacitor.isNativePlatform()) {
    try {
      const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem")
      await Filesystem.writeFile({
        path: filename,
        data: "\ufeff" + csvContent,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
      })
      alert(`Archivo guardado en Documentos: ${filename}`)
    } catch (error) {
      console.error("Error guardando archivo nativo:", error)
      alert("Error al guardar el archivo")
    }
    return
  }

  // En web, descargar normalmente
  const blob = new Blob(["\ufeff" + csvContent], {
    type: "text/csv;charset=utf-8;",
  })
  const link = document.createElement("a")
  const url = URL.createObjectURL(blob)
  link.setAttribute("href", url)
  link.setAttribute("download", filename)
  link.style.visibility = "hidden"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
