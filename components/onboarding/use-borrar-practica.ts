import { useState } from "react"
import { toast } from "sonner"
import { useModal } from "@/contexts/modal-context"

/**
 * Deletes the onboarding practice (order + client + its notifications) through
 * the narrow practice endpoint. Never through DELETE /api/ordenes/[id], which
 * would leave the practice client and the bell notifications behind.
 */
export function useBorrarPractica(onBorrada: () => void) {
  const { confirm, showError } = useModal()
  const [borrando, setBorrando] = useState(false)

  const borrar = async () => {
    const confirmado = await confirm({
      title: "Borrar práctica",
      description: "Se borran la orden de práctica y su cliente. Tus datos reales no se tocan.",
      confirmText: "Borrar",
      cancelText: "Cancelar",
      variant: "danger",
    })
    if (!confirmado) return

    setBorrando(true)
    try {
      const res = await fetch("/api/onboarding/practica", { method: "DELETE" })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        await showError(body?.error || "No pudimos borrar la práctica. Probá de nuevo.")
        return
      }
      toast.success("Práctica borrada")
      onBorrada()
    } catch (err) {
      console.error("Error deleting the practice:", err)
      await showError("No pudimos borrar la práctica. Revisá tu conexión y probá de nuevo.")
    } finally {
      setBorrando(false)
    }
  }

  return { borrar, borrando }
}
