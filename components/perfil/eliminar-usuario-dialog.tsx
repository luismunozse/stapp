"use client"

import { useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { GRACE_DAYS } from "@/lib/account-deletion/state"
import type { DeletionInfo } from "@/lib/account-deletion/types"
import { ReauthFields, EMPTY_REAUTH, isReauthComplete, toReauthPayload, reauthErrorMessage, type ReauthValue } from "./reauth-fields"
import { cerrarSesionTrasBaja } from "./cerrar-sesion-tras-baja"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  info: DeletionInfo
}

const LAST_ADMIN_MESSAGE =
  "Sos el único administrador del taller. Para salir tenés que eliminar el taller o transferir el rol de administrador a otra persona."
const FORBIDDEN_MESSAGE = "Esta acción no está permitida para tu usuario."
const NETWORK_MESSAGE = "Error de conexión. Reintentá en unos segundos."
const GENERIC_MESSAGE = "No pudimos eliminar tu usuario. Reintentá más tarde."

// Targets táctiles de 44px en pantallas coarse (WebView de la APK), igual que el Dialog base.
const TOUCH = "[@media(pointer:coarse)]:h-11"

export function EliminarUsuarioDialog({ open, onOpenChange, info }: Props) {
  const [value, setValue] = useState<ReauthValue>(EMPTY_REAUTH)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // El estado `loading` llega un render tarde: la ref frena un segundo clic en el mismo tick.
  const inFlight = useRef(false)

  const canSubmit = !loading && isReauthComplete(value, info.hasPassword, info.totpEnabled)

  const handleOpenChange = (next: boolean) => {
    if (loading) return
    if (!next) {
      setValue(EMPTY_REAUTH)
      setError(null)
    }
    onOpenChange(next)
  }

  const submit = async () => {
    if (inFlight.current || !isReauthComplete(value, info.hasPassword, info.totpEnabled)) return
    inFlight.current = true
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/account/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toReauthPayload(value, info.hasPassword, info.totpEnabled)),
      })
      const data: { code?: string; error?: string } = await res.json().catch(() => ({}))
      if (res.ok) {
        // Éxito: dejamos el botón deshabilitado, cerrarSesionTrasBaja siempre redirige.
        toast.success("Tu usuario fue eliminado")
        await cerrarSesionTrasBaja()
        return
      }
      setError(
        reauthErrorMessage(data) ??
          (res.status === 409 && data.code === "LAST_ADMIN"
            ? LAST_ADMIN_MESSAGE
            : res.status === 403
              ? FORBIDDEN_MESSAGE
              : data.error || GENERIC_MESSAGE),
      )
      inFlight.current = false
      setLoading(false)
    } catch {
      setError(NETWORK_MESSAGE)
      inFlight.current = false
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Eliminar mi usuario</DialogTitle>
          <DialogDescription>Esta acción cierra tu sesión y no se puede deshacer por tu cuenta.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">Se borran:</strong> tu nombre, email, teléfono, foto, contraseña y la
            verificación en dos pasos.
          </p>
          <p>
            <strong className="text-foreground">Se conservan:</strong> las operaciones que registraste (ventas, órdenes, caja)
            quedan en el taller, firmadas como “Usuario eliminado”.
          </p>
          <p>
            Tus datos se anonimizan de forma definitiva a los {GRACE_DAYS} días. Hasta entonces podés pedirle a soporte
            que lo revierta.
          </p>
        </div>

        <ReauthFields
          idPrefix="eliminar-usuario"
          hasPassword={info.hasPassword}
          totpEnabled={info.totpEnabled}
          value={value}
          onChange={setValue}
          disabled={loading}
          error={error}
        />

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className={TOUCH} onClick={() => handleOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="destructive" className={TOUCH} onClick={submit} disabled={!canSubmit}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Eliminar mi usuario
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
