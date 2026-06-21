"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { useModal } from "@/contexts/modal-context"

interface ReclamoFormProps {
  garantiaId: string
  onClose: () => void
  onSuccess: () => void
}

export function ReclamoForm({ garantiaId, onClose, onSuccess }: ReclamoFormProps) {
  const { showError } = useModal()
  const [descripcion, setDescripcion] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!descripcion.trim()) {
      await showError("La descripción es requerida")
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/garantias/${garantiaId}/reclamos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descripcion }),
      })

      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al crear reclamo")
        return
      }

      onSuccess()
    } catch (error) {
      console.error("Error:", error)
      await showError("Error al crear reclamo")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 border rounded-lg bg-yellow-50 dark:bg-yellow-950/30 dark:border-yellow-800">
      <div>
        <Label htmlFor="descripcion">Descripción del reclamo</Label>
        <Textarea
          id="descripcion"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Describa el problema o defecto encontrado..."
          rows={3}
          disabled={loading}
          required
        />
      </div>
      <div className="flex gap-2 justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={loading}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Enviando..." : "Enviar Reclamo"}
        </Button>
      </div>
    </form>
  )
}
