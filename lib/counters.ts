import { supabaseAdmin } from "./supabase"

/**
 * Obtener el siguiente número de orden para una organización
 * Usa una función PostgreSQL para garantizar atomicidad
 */
export async function getNextOrderNumber(organizationId: string): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("get_next_order_number", {
    org_id: organizationId,
  })

  if (error) {
    throw new Error(`Error getting next order number: ${error.message}`)
  }

  return data as number
}

/**
 * Obtener el siguiente número de cotización formateado
 * Formato: COT-0001
 */
export async function getNextQuoteNumber(organizationId: string): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc("get_next_quote_number", {
    org_id: organizationId,
  })

  if (error) {
    throw new Error(`Error getting next quote number: ${error.message}`)
  }

  const num = data as number
  return `COT-${num.toString().padStart(4, "0")}`
}

/**
 * Obtener el siguiente número de factura formateado
 * Formato: 0001-00000001 (sucursal-número)
 */
export async function getNextInvoiceNumber(organizationId: string): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc("get_next_invoice_number", {
    org_id: organizationId,
  })

  if (error) {
    throw new Error(`Error getting next invoice number: ${error.message}`)
  }

  const num = data as number
  // Formato: 0001-00000001 (punto de venta - número)
  return `0001-${num.toString().padStart(8, "0")}`
}

/**
 * Inicializar contadores para una organización nueva
 */
export async function initializeCounters(organizationId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("organization_counters")
    .insert({
      organization_id: organizationId,
      next_order_number: 1,
      next_quote_number: 1,
      next_invoice_number: 1,
    })

  // Ignorar error de unique constraint si ya existe
  if (error && !error.message.includes("duplicate key")) {
    throw new Error(`Error initializing counters: ${error.message}`)
  }
}

/**
 * Obtener los contadores actuales (sin incrementar)
 */
export async function getCounters(organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from("organization_counters")
    .select("*")
    .eq("organization_id", organizationId)
    .single()

  if (error) {
    // Si no existe, crear e inicializar
    if (error.code === "PGRST116") {
      await initializeCounters(organizationId)
      return {
        next_order_number: 1,
        next_quote_number: 1,
        next_invoice_number: 1,
      }
    }
    throw new Error(`Error getting counters: ${error.message}`)
  }

  return data
}

/**
 * Sincronizar contadores basándose en los datos existentes
 * Útil para migración de datos o recuperación
 */
export async function syncCounters(organizationId: string): Promise<void> {
  // Obtener el máximo número de orden
  const { data: maxOrder } = await supabaseAdmin
    .from("ordenes_servicio")
    .select("numero_orden")
    .eq("organization_id", organizationId)
    .order("numero_orden", { ascending: false })
    .limit(1)
    .single()

  // Obtener el máximo número de cotización (extraer número del formato COT-XXXX)
  const { data: quotes } = await supabaseAdmin
    .from("cotizaciones")
    .select("numero_cotizacion, ordenes_servicio!inner(organization_id)")
    .eq("ordenes_servicio.organization_id", organizationId)

  let maxQuoteNum = 0
  if (quotes) {
    for (const q of quotes) {
      const match = q.numero_cotizacion.match(/COT-(\d+)/)
      if (match) {
        const num = parseInt(match[1])
        if (num > maxQuoteNum) maxQuoteNum = num
      }
    }
  }

  // Obtener el máximo número de factura (extraer número del formato XXXX-XXXXXXXX)
  const { data: invoices } = await supabaseAdmin
    .from("facturas")
    .select("numero_factura, ordenes_servicio!inner(organization_id)")
    .eq("ordenes_servicio.organization_id", organizationId)

  let maxInvoiceNum = 0
  if (invoices) {
    for (const f of invoices) {
      const match = f.numero_factura.match(/\d+-(\d+)/)
      if (match) {
        const num = parseInt(match[1])
        if (num > maxInvoiceNum) maxInvoiceNum = num
      }
    }
  }

  // Actualizar o crear contadores
  const { error } = await supabaseAdmin
    .from("organization_counters")
    .upsert({
      organization_id: organizationId,
      next_order_number: (maxOrder?.numero_orden || 0) + 1,
      next_quote_number: maxQuoteNum + 1,
      next_invoice_number: maxInvoiceNum + 1,
    })

  if (error) {
    throw new Error(`Error syncing counters: ${error.message}`)
  }
}
