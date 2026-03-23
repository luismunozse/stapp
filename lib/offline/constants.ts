// Offline sync constants

export const DB_NAME = "stapp-offline"
export const DB_VERSION = 2

// IndexedDB store names
export const STORES = {
  ORDERS: "pendingOrders",
  CLIENTS: "pendingClients",
  SALES: "pendingVentas",
  PAYMENTS: "pendingPagos",
  COBROS: "pendingCobros",
  ORDER_EDITS: "pendingOrderEdits",
  INVOICES: "pendingFacturas",
  UPLOADS: "pendingUploads",
} as const

export type StoreName = (typeof STORES)[keyof typeof STORES]

// All store names for iteration
export const ALL_STORES: StoreName[] = Object.values(STORES)

// Background Sync tags
export const SYNC_TAGS: Record<StoreName, string> = {
  [STORES.ORDERS]: "sync-orders",
  [STORES.CLIENTS]: "sync-clients",
  [STORES.SALES]: "sync-ventas",
  [STORES.PAYMENTS]: "sync-pagos",
  [STORES.COBROS]: "sync-cobros",
  [STORES.ORDER_EDITS]: "sync-order-edits",
  [STORES.INVOICES]: "sync-facturas",
  [STORES.UPLOADS]: "sync-uploads",
}

// Operation types for display
export const OPERATION_LABELS: Record<StoreName, string> = {
  [STORES.ORDERS]: "Orden de servicio",
  [STORES.CLIENTS]: "Cliente",
  [STORES.SALES]: "Venta",
  [STORES.PAYMENTS]: "Pago",
  [STORES.COBROS]: "Cobro",
  [STORES.ORDER_EDITS]: "Edición de orden",
  [STORES.INVOICES]: "Factura",
  [STORES.UPLOADS]: "Archivo",
}

// Retry config
export const MAX_RETRIES = 5
export const SYNC_INTERVAL_MS = 30_000 // 30 seconds for iOS fallback
export const PENDING_CHECK_INTERVAL_MS = 5_000 // 5 seconds for UI polling

export interface PendingOperation {
  id?: number
  storeName: StoreName
  url: string
  method: "POST" | "PUT" | "PATCH" | "DELETE"
  body: any
  headers?: Record<string, string>
  tempId: string
  createdAt: string
  retryCount: number
  lastError: string | null
  status: "pending" | "syncing" | "failed" | "conflict"
  description?: string // Human-readable description for UI
}
