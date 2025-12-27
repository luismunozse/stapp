"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { X, AlertTriangle } from "lucide-react"

interface ReclamoFormProps {
  garantiaId: string
  onClose: () => void
  onSuccess: () => void
}

export function ReclamoForm({ garantiaId, onClose, onSuccess }: ReclamoFormProps) {
  const [loading, setLoading] = useState(false)
  const [descripcion, setDescripcion] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!descripcion.trim()) {
      alert("La descripción del problema es requerida")
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
        alert(error.error || "Error al registrar reclamo")
        return
      }

      onSuccess()
    } catch (error) {
      console.error("Error:", error)
      alert("Error al registrar reclamo")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="mb-4 border-yellow-200 bg-yellow-50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-yellow-800">
            <AlertTriangle className="h-5 w-5" />
            Nuevo Reclamo de Garantía
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="descripcion">Descripción del problema *</Label>
            <Textarea
              id="descripcion"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Describa detalladamente el problema reportado por el cliente..."
              rows={4}
              disabled={loading}
              className="bg-white"
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} variant="destructive">
              {loading ? "Registrando..." : "Registrar Reclamo"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
