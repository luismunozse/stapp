"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Smartphone, Trash2, Download, Search, Mail } from "lucide-react"
import { formatDateTime } from "@/lib/utils"
import { toast } from "sonner"

interface WaitlistEntry {
  id: string
  email: string
  created_at: string
}

export default function WaitlistPage() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/superadmin/waitlist/ios")
      if (!res.ok) throw new Error("Error fetching waitlist")
      const data = await res.json()
      setEntries(data.entries || [])
    } catch (error) {
      console.error("Error:", error)
      toast.error("Error al cargar la waitlist")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchEntries()
  }, [fetchEntries])

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este registro?")) return
    try {
      const res = await fetch("/api/superadmin/waitlist/ios", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error()
      setEntries((prev) => prev.filter((e) => e.id !== id))
      toast.success("Registro eliminado")
    } catch {
      toast.error("Error al eliminar")
    }
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
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Email
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
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
                        colSpan={3}
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
                      <td
                        colSpan={3}
                        className="px-4 py-8 text-center text-muted-foreground"
                      >
                        {search
                          ? "No se encontraron resultados"
                          : "No hay registros en la waitlist"}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((entry) => (
                      <tr
                        key={entry.id}
                        className="border-b last:border-0 transition-colors hover:bg-muted/50"
                      >
                        <td className="px-4 py-3 font-medium">{entry.email}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatDateTime(entry.created_at)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(entry.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
