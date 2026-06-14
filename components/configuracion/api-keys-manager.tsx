"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Plus,
  Loader2,
  Copy,
  Check,
  AlertTriangle,
  Trash2,
  KeyRound,
} from "lucide-react"
import { toast } from "sonner"

interface ApiKey {
  id: string
  name: string
  prefix: string
  last_used_at: string | null
  activo: boolean
  created_at: string
  revoked_at: string | null
}

export function ApiKeysManager() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [revokeId, setRevokeId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Form state
  const [name, setName] = useState("")
  const [formError, setFormError] = useState("")

  // Raw key shown once after creation
  const [newKey, setNewKey] = useState<string | null>(null)
  const [keyCopied, setKeyCopied] = useState(false)

  const fetchKeys = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/keys")
      const json = await res.json()
      setKeys(json.data || [])
    } catch {
      toast.error("Error al cargar las API keys")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchKeys()
  }, [fetchKeys])

  const openCreate = () => {
    setName("")
    setFormError("")
    setDialogOpen(true)
  }

  const handleCreate = async () => {
    setFormError("")
    if (!name.trim()) return setFormError("Nombre requerido")

    setSaving(true)
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || "Error al crear la key")
      }
      const created = await res.json()
      setDialogOpen(false)
      if (created.key) setNewKey(created.key)
      fetchKeys()
      toast.success("API key creada")
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Error al crear la key")
    } finally {
      setSaving(false)
    }
  }

  const handleRevoke = async () => {
    if (!revokeId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/keys/${revokeId}`, { method: "DELETE" })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || "Error al revocar")
      }
      setRevokeId(null)
      fetchKeys()
      toast.success("API key revocada")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al revocar la key")
    } finally {
      setSaving(false)
    }
  }

  const copyKey = async () => {
    if (!newKey) return
    await navigator.clipboard.writeText(newKey)
    setKeyCopied(true)
    setTimeout(() => setKeyCopied(false), 2000)
  }

  const closeKeyDialog = () => {
    setNewKey(null)
    setKeyCopied(false)
  }

  return (
    <div className="space-y-6">
      <Button onClick={openCreate}>
        <Plus className="h-4 w-4 mr-1" /> Crear API key
      </Button>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : keys.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Todavía no tenés API keys.
            <br />
            Creá una para integrar servicios externos con tu cuenta.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {keys.map((k) => {
            const isActive = k.activo && !k.revoked_at
            return (
              <Card key={k.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-semibold truncate">{k.name}</span>
                        {isActive ? (
                          <Badge variant="outline" className="text-xs text-success-600 border-success-200">
                            Activa
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            Revocada
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">
                        {k.prefix}••••••••••••••••
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Creada: {new Date(k.created_at).toLocaleString()}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Último uso:{" "}
                        {k.last_used_at
                          ? new Date(k.last_used_at).toLocaleString()
                          : "Nunca"}
                      </div>
                      {k.revoked_at && (
                        <div className="text-[11px] text-muted-foreground">
                          Revocada: {new Date(k.revoked_at).toLocaleString()}
                        </div>
                      )}
                    </div>
                    {isActive && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Revocar"
                        onClick={() => setRevokeId(k.id)}
                        className="text-destructive hover:text-destructive shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva API key</DialogTitle>
            <DialogDescription>
              El valor de la key se muestra <strong>solo una vez</strong> tras la creación.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">Nombre</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Integración ERP"
                className="mt-1"
                maxLength={100}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Raw key — shown once */}
      <Dialog open={!!newKey} onOpenChange={(o) => !o && closeKeyDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning-500" />
              Guardá esta key ahora
            </DialogTitle>
            <DialogDescription>
              Este valor se muestra <strong>solo una vez</strong>. No se vuelve a mostrar.
              Guardalo en un lugar seguro antes de cerrar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted p-3 font-mono text-xs break-all select-all">
              {newKey}
            </div>
            <Button onClick={copyKey} variant="outline" className="w-full">
              {keyCopied ? (
                <>
                  <Check className="h-4 w-4 mr-1" /> Copiado
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-1" /> Copiar al portapapeles
                </>
              )}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={closeKeyDialog}>Entendido</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirm */}
      <ConfirmDialog
        open={!!revokeId}
        onOpenChange={(o) => !o && setRevokeId(null)}
        title="Revocar API key"
        description="La key quedará inactiva de inmediato. Las integraciones que la usen dejarán de funcionar."
        confirmText="Revocar"
        cancelText="Cancelar"
        variant="danger"
        loading={saving}
        onConfirm={handleRevoke}
      />
    </div>
  )
}
