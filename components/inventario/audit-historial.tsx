"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Loader2, Plus, Pencil, Trash2, User, Clock } from "lucide-react"

interface AuditLog {
  id: string
  action: "CREATE" | "UPDATE" | "DELETE"
  description: string
  changes: { before?: Record<string, unknown>; after?: Record<string, unknown> } | null
  user: { id: string; nombre: string; email: string } | null
  ipAddress: string | null
  createdAt: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  inventarioId: string
  inventarioNombre: string
}

const FIELD_LABEL: Record<string, string> = {
  codigo: "Código",
  nombre: "Nombre",
  descripcion: "Descripción",
  categoria: "Categoría",
  tipo_dispositivo: "Tipo",
  precio_compra: "Precio compra",
  precio_venta: "Precio venta",
  proveedor: "Proveedor (texto)",
  proveedor_id: "Proveedor",
  stock_minimo: "Stock mínimo",
  stock_maximo: "Stock máximo",
  punto_reorden: "Punto reorden",
  barcode: "Barcode",
  ubicacion: "Ubicación",
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—"
  if (typeof v === "boolean") return v ? "sí" : "no"
  if (typeof v === "number") return v.toLocaleString("es-AR")
  return String(v)
}

function actionBadge(a: AuditLog["action"]) {
  switch (a) {
    case "CREATE":
      return <Badge variant="outline" className="gap-1 border-emerald-500/60 text-emerald-600"><Plus className="h-3 w-3" /> Creado</Badge>
    case "UPDATE":
      return <Badge variant="outline" className="gap-1 border-blue-500/60 text-blue-600"><Pencil className="h-3 w-3" /> Editado</Badge>
    case "DELETE":
      return <Badge variant="outline" className="gap-1 border-destructive text-destructive"><Trash2 className="h-3 w-3" /> Eliminado</Badge>
  }
}

export function AuditHistorial({ open, onOpenChange, inventarioId, inventarioNombre }: Props) {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch(`/api/inventario/${inventarioId}/audit`)
      .then((r) => r.json())
      .then((j) => setLogs(j.data || []))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false))
  }, [open, inventarioId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Historial de cambios</DialogTitle>
          <p className="text-xs text-muted-foreground truncate">{inventarioNombre}</p>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            Sin cambios registrados todavía.
            <div className="text-xs mt-1">Los cambios en precio, categoría, proveedor, etc. aparecen acá. El stock vive en la pestaña Movimientos.</div>
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 -mx-6 px-6 space-y-3">
            {logs.map((log) => {
              const before = log.changes?.before || {}
              const after = log.changes?.after || {}
              const fieldsChanged = log.action === "UPDATE"
                ? Object.keys(after).filter((k) => k !== "stock")
                : []
              return (
                <div key={log.id} className="border rounded-md p-3 text-sm">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {actionBadge(log.action)}
                      <span className="text-muted-foreground text-xs">{log.description}</span>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <Clock className="h-3 w-3" />
                        {new Date(log.createdAt).toLocaleString("es-AR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      <div className="flex items-center gap-1 justify-end mt-0.5">
                        <User className="h-3 w-3" />
                        {log.user?.nombre || "Sistema"}
                      </div>
                    </div>
                  </div>

                  {fieldsChanged.length > 0 && (
                    <div className="space-y-1 mt-2 border-t pt-2">
                      {fieldsChanged.map((k) => (
                        <div key={k} className="text-xs grid grid-cols-[100px_1fr_1fr] gap-2 items-center">
                          <span className="text-muted-foreground">{FIELD_LABEL[k] || k}</span>
                          <span className="line-through text-muted-foreground truncate">{formatVal(before[k])}</span>
                          <span className="font-medium truncate">{formatVal(after[k])}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {log.action === "CREATE" && Object.keys(after).length > 0 && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-muted-foreground">Ver valores iniciales</summary>
                      <div className="mt-1 grid grid-cols-2 gap-1">
                        {Object.entries(after).map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-2">
                            <span className="text-muted-foreground">{FIELD_LABEL[k] || k}:</span>
                            <span className="font-medium truncate">{formatVal(v)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
