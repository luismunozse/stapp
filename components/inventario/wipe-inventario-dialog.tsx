"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertTriangle, Loader2 } from "lucide-react"
import { useModal } from "@/contexts/modal-context"

interface WipeInventarioDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

const CONFIRM_PHRASE = "ELIMINAR TODO"

export function WipeInventarioDialog({ open, onOpenChange, onSuccess }: WipeInventarioDialogProps) {
  const { showError, showSuccess, confirm } = useModal()
  const [phrase, setPhrase] = useState("")
  const [pending, setPending] = useState(false)

  const close = () => {
    if (pending) return
    setPhrase("")
    onOpenChange(false)
  }

  const handleWipe = async () => {
    if (phrase.trim() !== CONFIRM_PHRASE) return
    setPending(true)
    try {
      const res = await fetch("/api/inventario/all", { method: "DELETE" })
      const json = await res.json()
      if (!res.ok) {
        await showError(json.error || "Error al eliminar el inventario")
        return
      }
      const deleted: number = json.deleted ?? 0
      const blocked: Array<{ id: string; codigo: string | null; nombre: string | null }> = json.blocked ?? []

      setPhrase("")
      onOpenChange(false)
      onSuccess()

      if (blocked.length === 0) {
        await showSuccess(`${deleted} item${deleted === 1 ? "" : "s"} eliminados`)
        return
      }

      const preview = blocked
        .slice(0, 3)
        .map((b) => `${b.codigo ?? "—"} ${b.nombre ?? ""}`.trim())
        .join(", ")
      const more = blocked.length > 3 ? ` y ${blocked.length - 3} más` : ""
      const wantArchive = await confirm({
        title: deleted > 0
          ? `${deleted} eliminado${deleted === 1 ? "" : "s"}, ${blocked.length} en uso`
          : `${blocked.length} item${blocked.length === 1 ? "" : "s"} en uso`,
        description: `${blocked.length === 1 ? "Este item no se puede eliminar" : "Estos items no se pueden eliminar"} porque ${blocked.length === 1 ? "está" : "están"} en uso (${preview}${more}). ¿Archivar${blocked.length === 1 ? "lo" : "los"} en su lugar?`,
        confirmText: "Archivar",
        cancelText: "Mantener",
        variant: "info",
      })
      if (!wantArchive) return

      const blockedIds = blocked.map((b) => b.id)
      const arcRes = await fetch("/api/inventario/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: blockedIds, action: "archive" }),
      })
      const arcJson = await arcRes.json()
      if (!arcRes.ok) {
        await showError(arcJson.error || "Error al archivar")
        return
      }
      await showSuccess(`${arcJson.updated} item${arcJson.updated === 1 ? "" : "s"} archivados`)
      onSuccess()
    } catch {
      await showError("Error de red al eliminar el inventario")
    } finally {
      setPending(false)
    }
  }

  const matches = phrase.trim() === CONFIRM_PHRASE

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <DialogTitle>Eliminar todo el inventario</DialogTitle>
          <DialogDescription>
            Esta acción elimina permanentemente todos los productos del inventario
            de tu organización. Los items en uso en órdenes, compras o devoluciones
            no se podrán eliminar y se ofrecerán para archivar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="wipe-confirm">
            Escribí <span className="font-mono font-semibold">{CONFIRM_PHRASE}</span> para confirmar
          </Label>
          <Input
            id="wipe-confirm"
            autoComplete="off"
            autoFocus
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder={CONFIRM_PHRASE}
            disabled={pending}
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={close} disabled={pending}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleWipe}
            disabled={!matches || pending}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Eliminar todo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
