"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Plus,
  Monitor,
  Trash2,
  Copy,
  ExternalLink,
  Loader2,
  CheckCircle2,
} from "lucide-react"
import { useModal } from "@/contexts/modal-context"

interface KioskToken {
  id: string
  token: string
  name: string
  config: Record<string, unknown>
  activo: boolean
  created_at: string
}

export function KioskConfigView() {
  const [tokens, setTokens] = useState<KioskToken[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [copied, setCopied] = useState<string | null>(null)
  const { confirm, showError } = useModal()

  const fetchTokens = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/kiosco")
      if (res.ok) {
        const data = await res.json()
        setTokens(data)
      }
    } catch (err) {
      console.error("Error fetching tokens:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTokens()
  }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const res = await fetch("/api/kiosco", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      })

      if (!res.ok) {
        const data = await res.json()
        if (data.code === "PREMIUM_REQUIRED") {
          await showError("Esta función requiere el plan Premium.")
        } else {
          await showError(data.error || "Error al crear kiosco")
        }
        return
      }

      setNewName("")
      fetchTokens()
    } catch (err) {
      console.error("Error creating token:", err)
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    const confirmed = await confirm({
      title: "Eliminar pantalla",
      description: `¿Eliminar la pantalla "${name}"? El link dejará de funcionar.`,
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })

    if (!confirmed) return

    try {
      await fetch(`/api/kiosco/${id}`, { method: "DELETE" })
      fetchTokens()
    } catch (err) {
      console.error("Error deleting token:", err)
    }
  }

  const getKioskUrl = (token: string) => {
    if (typeof window === "undefined") return ""
    const host = window.location.host
    const protocol = window.location.protocol
    return `${protocol}//${host}/kiosco/${token}`
  }

  const copyUrl = (token: string) => {
    navigator.clipboard.writeText(getKioskUrl(token))
    setCopied(token)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Create new */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            Nueva pantalla
          </CardTitle>
          <CardDescription>
            Creá un link para mostrar el estado de las órdenes en una TV o monitor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <div className="flex-1">
              <Label className="sr-only">Nombre de la pantalla</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ej: Pantalla del local"
              />
            </div>
            <Button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
            >
              {creating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Crear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Token list */}
      {loading ? (
        <div className="text-center py-8 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
          Cargando...
        </div>
      ) : tokens.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Monitor className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No tenés pantallas configuradas</p>
            <p className="text-sm">Creá una para empezar a mostrar el estado en tu local.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {tokens.map((t) => (
            <Card key={t.id}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{t.name}</p>
                    <p className="text-sm text-muted-foreground mt-1 font-mono break-all">
                      {getKioskUrl(t.token)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyUrl(t.token)}
                    >
                      {copied === t.token ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(getKioskUrl(t.token), "_blank")}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(t.id, t.name)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
