"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Smartphone, Trash2, Download, Search, Mail, X, Loader2, Inbox } from "lucide-react"
import { formatDateTime } from "@/lib/utils"
import { useSuperadminFetch, useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

interface WaitlistEntry {
  id: string
  email: string
  created_at: string
}

export default function WaitlistPage() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([])
  const [search, setSearch] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<WaitlistEntry | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)

  const { loading, fetchData } = useSuperadminFetch<{ entries: WaitlistEntry[] }>()
  const { mutate, loading: deleting } = useSuperadminMutation()
  const { mutate: bulkMutate, loading: bulkDeleting } = useSuperadminMutation()

  const fetchEntries = useCallback(async () => {
    const result = await fetchData("/api/superadmin/waitlist/ios")
    if (result) {
      setEntries(result.entries || [])
    }
  }, [fetchData])

  useEffect(() => {
    fetchEntries()
  }, [fetchEntries])

  const handleDelete = async () => {
    if (!deleteTarget) return
    await mutate("/api/superadmin/waitlist/ios", {
      method: "DELETE",
      body: { id: deleteTarget.id },
      successMessage: "Registro eliminado",
      errorMessage: "Error al eliminar",
      onSuccess: () => {
        setEntries((prev) => prev.filter((e) => e.id !== deleteTarget.id))
        setDeleteTarget(null)
      },
    })
  }

  const handleBulkDelete = async () => {
    await bulkMutate("/api/superadmin/waitlist/ios/bulk-delete", {
      method: "POST",
      body: { ids: selectedIds },
      successMessage: `${selectedIds.length} registros eliminados`,
      errorMessage: "Error al eliminar registros en lote",
      onSuccess: () => {
        setEntries((prev) => prev.filter((e) => !selectedIds.includes(e.id)))
        setSelectedIds([])
        setShowBulkDeleteConfirm(false)
      },
    })
  }

  const handleExportCSV = () => {
    const csv = [
      "email,fecha_registro",
      ...filtered.map((e) => `${e.email},${e.created_at}`),
    ].join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `ios-waitlist-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filtered = entries.filter((e) =>
    e.email.toLowerCase().includes(search.toLowerCase())
  )

  const handleSelectAll = () => {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(filtered.map((e) => e.id))
    }
  }

  const handleSelectRow = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((k) => k !== id))
    } else {
      setSelectedIds([...selectedIds, id])
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Smartphone className="h-8 w-8" />
          Waitlist iOS
        </h1>
        <p className="text-muted-foreground">
          Emails registrados para la app de iOS
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Mail className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{entries.length}</p>
                <p className="text-sm text-muted-foreground">Total registrados</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <CardTitle>Registros</CardTitle>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-initial">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar email..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 w-full sm:w-[250px]"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCSV}
                disabled={filtered.length === 0}
              >
                <Download className="h-4 w-4 mr-1.5" />
                CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {selectedIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-lg bg-muted/50 border">
              <span className="text-sm font-medium">
                {selectedIds.length} seleccionados
              </span>
              <div className="flex flex-wrap gap-2 ml-auto">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 border-red-600 hover:bg-red-50"
                  onClick={() => setShowBulkDeleteConfirm(true)}
                  disabled={bulkDeleting}
                >
                  {bulkDeleting ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-1.5" />
                  )}
                  Eliminar seleccionados
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedIds([])}
                  disabled={bulkDeleting}
                >
                  <X className="h-4 w-4 mr-1.5" />
                  Deseleccionar
                </Button>
              </div>
            </div>
          )}
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="w-12 px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={filtered.length > 0 && selectedIds.length === filtered.length}
                        onChange={handleSelectAll}
                        className="h-4 w-4 rounded border-input"
                      />
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Email
                    </th>
                    <th className="hidden sm:table-cell px-4 py-3 text-left font-medium text-muted-foreground">
                      Fecha de registro
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-8 text-center text-muted-foreground"
                      >
                        <div className="flex items-center justify-center gap-2">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                          Cargando...
                        </div>
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-0">
                        {search ? (
                          <div className="px-4 py-8 text-center text-muted-foreground">
                            No se encontraron resultados
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center py-12 px-4">
                            <div className="flex items-center justify-center w-16 h-16 mb-4 rounded-full bg-muted">
                              <Inbox className="h-8 w-8 text-muted-foreground" />
                            </div>
                            <h3 className="text-lg font-semibold mb-2">No hay registros en la waitlist</h3>
                            <p className="text-sm text-muted-foreground text-center max-w-sm">
                              Los usuarios interesados en la app de iOS aparecerán aquí cuando se registren.
                            </p>
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((entry) => {
                      const isSelected = selectedIds.includes(entry.id)
                      return (
                        <tr
                          key={entry.id}
                          className={`border-b last:border-0 transition-colors hover:bg-muted/50 ${isSelected ? "bg-primary/5" : ""}`}
                        >
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleSelectRow(entry.id)}
                              className="h-4 w-4 rounded border-input"
                            />
                          </td>
                          <td className="px-4 py-3 font-medium">{entry.email}</td>
                          <td className="hidden sm:table-cell px-4 py-3 text-muted-foreground">
                            {formatDateTime(entry.created_at)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteTarget(entry)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Eliminar registro"
        description={`¿Estás seguro de eliminar el registro de "${deleteTarget?.email}"? Esta acción no se puede deshacer.`}
        confirmText="Eliminar"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={showBulkDeleteConfirm}
        onOpenChange={(open) => !open && setShowBulkDeleteConfirm(false)}
        title="Eliminar registros seleccionados"
        description={`¿Estás seguro de eliminar ${selectedIds.length} registros seleccionados? Esta acción no se puede deshacer.`}
        confirmText="Eliminar todos"
        variant="danger"
        loading={bulkDeleting}
        onConfirm={handleBulkDelete}
      />
    </div>
  )
}
