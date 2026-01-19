"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Eye, EyeOff } from "lucide-react"

interface VendedorFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  vendedor?: {
    id: string
    nombre: string
    email: string
  } | null
  onSuccess: () => void
}

export function VendedorForm({ open, onOpenChange, vendedor, onSuccess }: VendedorFormProps) {
  const [nombre, setNombre] = useState(vendedor?.nombre || "")
  const [email, setEmail] = useState(vendedor?.email || "")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const isEditing = !!vendedor

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const url = isEditing ? `/api/vendedores/${vendedor.id}` : "/api/vendedores"
      const method = isEditing ? "PUT" : "POST"

      const body: { nombre: string; email: string; password?: string } = { nombre, email }
      if (password) body.password = password

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Error al guardar")
      }

      onSuccess()
      onOpenChange(false)
      resetForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar vendedor")
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setNombre("")
    setEmail("")
    setPassword("")
    setError("")
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm()
    } else if (vendedor) {
      setNombre(vendedor.nombre)
      setEmail(vendedor.email)
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Editar Vendedor" : "Nuevo Vendedor"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Modifica los datos del vendedor. Deja la contraseña vacía para mantener la actual."
              : "Completa los datos para crear un nuevo vendedor."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded text-sm">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="nombre">Nombre</Label>
            <Input
              id="nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Nombre completo"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@ejemplo.com"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">
              Contraseña {isEditing && "(dejar vacío para mantener)"}
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required={!isEditing}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : isEditing ? "Guardar Cambios" : "Crear Vendedor"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
