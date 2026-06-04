"use client"

import { useState, useEffect } from "react"
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
import { FormActionBar } from "@/components/ui/form-action-bar"
import { Eye, EyeOff } from "lucide-react"

interface VendedorFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  vendedor?: {
    id: string
    nombre: string
    email: string
    telefono?: string | null
    activo?: boolean
    porcentajeComision?: number
  } | null
  onSuccess: () => void
}

interface SucursalOpt {
  id: string
  nombre: string
  principal: boolean
}

export function VendedorForm({ open, onOpenChange, vendedor, onSuccess }: VendedorFormProps) {
  const [nombre, setNombre] = useState(vendedor?.nombre || "")
  const [email, setEmail] = useState(vendedor?.email || "")
  const [password, setPassword] = useState("")
  const [telefono, setTelefono] = useState(vendedor?.telefono || "")
  const [activo, setActivo] = useState(vendedor?.activo !== false)
  const [porcentajeComision, setPorcentajeComision] = useState(
    vendedor?.porcentajeComision?.toString() || "0"
  )
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [sucursales, setSucursales] = useState<SucursalOpt[]>([])
  const [sucursalId, setSucursalId] = useState("")

  const isEditing = !!vendedor

  useEffect(() => {
    if (!open) return
    fetch("/api/sucursales")
      .then((r) => r.json())
      .then((d) => {
        const list: SucursalOpt[] = d.data ?? []
        setSucursales(list)
        if (list.length > 0) {
          const principal = list.find((s) => s.principal) ?? list[0]
          setSucursalId((prev) => prev || principal.id)
        }
      })
      .catch(() => {})
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    const porcentajeNum = Number(porcentajeComision)
    if (!Number.isFinite(porcentajeNum) || porcentajeNum < 0 || porcentajeNum > 100) {
      setError("El porcentaje de comisión debe estar entre 0 y 100")
      return
    }

    setLoading(true)

    try {
      const url = isEditing ? `/api/vendedores/${vendedor.id}` : "/api/vendedores"
      const method = isEditing ? "PUT" : "POST"

      const body: {
        nombre: string
        email: string
        password?: string
        telefono: string | null
        porcentajeComision: number
        activo?: boolean
        sucursalId?: string
      } = {
        nombre,
        email,
        telefono: telefono.trim() || null,
        porcentajeComision: porcentajeNum,
      }
      if (password) body.password = password
      if (isEditing) body.activo = activo
      if (!isEditing && sucursalId) body.sucursalId = sucursalId

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
    setTelefono("")
    setActivo(true)
    setPorcentajeComision("0")
    setError("")
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm()
    } else if (vendedor) {
      setNombre(vendedor.nombre)
      setEmail(vendedor.email)
      setTelefono(vendedor.telefono || "")
      setActivo(vendedor.activo !== false)
      setPorcentajeComision(vendedor.porcentajeComision?.toString() || "0")
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
              inputMode="email"
              autoComplete="email"
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
          <div className="space-y-2">
            <Label htmlFor="telefono">Teléfono</Label>
            <Input
              id="telefono"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="+54 11 1234-5678"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="porcentajeComision">Porcentaje de comisión (%)</Label>
            <Input
              id="porcentajeComision"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={porcentajeComision}
              onChange={(e) => setPorcentajeComision(e.target.value)}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">
              Comisión por defecto aplicada sobre cada venta.
            </p>
          </div>
          {!isEditing && sucursales.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="sucursal">Sucursal</Label>
              <select
                id="sucursal"
                value={sucursalId}
                onChange={(e) => setSucursalId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                El vendedor solo verá las ventas de su sucursal.
              </p>
            </div>
          )}
          {isEditing && (
            <div className="flex items-center gap-2 pt-2">
              <input
                id="activo"
                type="checkbox"
                checked={activo}
                onChange={(e) => setActivo(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="activo" className="cursor-pointer">
                Vendedor activo
              </Label>
              {!activo && (
                <span className="text-xs text-muted-foreground">
                  — no aparecerá en nuevas asignaciones
                </span>
              )}
            </div>
          )}
          <FormActionBar inDialog className="pt-4">
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
          </FormActionBar>
        </form>
      </DialogContent>
    </Dialog>
  )
}
