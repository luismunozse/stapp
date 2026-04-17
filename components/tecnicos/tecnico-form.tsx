"use client"

import { useEffect, useState } from "react"
import useSWR from "swr"
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
import { Eye, EyeOff, Check } from "lucide-react"
import { cn } from "@/lib/utils"

interface TecnicoFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tecnico?: {
    id: string
    nombre: string
    email: string
    porcentajeComision?: number
    telefono?: string | null
    especialidades?: string[]
    fechaIngresoTecnico?: string | null
  } | null
  onSuccess: () => void
}

interface TipoDispositivo {
  codigo: string
  nombre: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function TecnicoForm({ open, onOpenChange, tecnico, onSuccess }: TecnicoFormProps) {
  const [nombre, setNombre] = useState("")
  const [email, setEmail] = useState("")
  const [telefono, setTelefono] = useState("")
  const [password, setPassword] = useState("")
  const [porcentajeComision, setPorcentajeComision] = useState<string>("0")
  const [especialidades, setEspecialidades] = useState<string[]>([])
  const [fechaIngreso, setFechaIngreso] = useState<string>("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const { data: tipos = [] } = useSWR<TipoDispositivo[]>(
    open ? "/api/tipos-dispositivo" : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  const isEditing = !!tecnico

  useEffect(() => {
    if (!open) return
    if (tecnico) {
      setNombre(tecnico.nombre)
      setEmail(tecnico.email)
      setTelefono(tecnico.telefono ?? "")
      setPorcentajeComision(
        tecnico.porcentajeComision != null ? String(tecnico.porcentajeComision) : "0"
      )
      setEspecialidades(tecnico.especialidades ?? [])
      setFechaIngreso(tecnico.fechaIngresoTecnico ?? "")
    } else {
      resetForm()
    }
    setError("")
    setPassword("")
  }, [open, tecnico])

  const resetForm = () => {
    setNombre("")
    setEmail("")
    setTelefono("")
    setPassword("")
    setPorcentajeComision("0")
    setEspecialidades([])
    setFechaIngreso("")
    setError("")
  }

  const toggleEspecialidad = (codigo: string) => {
    setEspecialidades((prev) =>
      prev.includes(codigo) ? prev.filter((e) => e !== codigo) : [...prev, codigo]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const url = isEditing ? `/api/tecnicos/${tecnico.id}` : "/api/tecnicos"
      const method = isEditing ? "PUT" : "POST"

      const porcNum = parseFloat(porcentajeComision) || 0
      if (porcNum < 0 || porcNum > 100) {
        throw new Error("El porcentaje de comisión debe estar entre 0 y 100")
      }

      const body: Record<string, unknown> = {
        nombre,
        email,
        telefono: telefono.trim() || null,
        porcentajeComision: porcNum,
        especialidades,
        fechaIngresoTecnico: fechaIngreso || null,
      }
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
      setError(err instanceof Error ? err.message : "Error al guardar técnico")
    } finally {
      setLoading(false)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) resetForm()
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Editar Técnico" : "Nuevo Técnico"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Modifica los datos del técnico. Deja la contraseña vacía para mantener la actual."
              : "Completa los datos para crear un nuevo técnico."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="nombre">Nombre *</Label>
              <Input
                id="nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Nombre completo"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telefono">Teléfono / WhatsApp</Label>
              <Input
                id="telefono"
                type="tel"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="+54 9 11 ..."
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
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
              {!isEditing && " *"}
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="porcentajeComision">% Comisión sobre ganancia</Label>
              <Input
                id="porcentajeComision"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={porcentajeComision}
                onChange={(e) => setPorcentajeComision(e.target.value)}
                placeholder="0"
              />
              <p className="text-[11px] text-muted-foreground">
                Sobre (costo final − repuestos) de cada orden.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fechaIngreso">Fecha de ingreso</Label>
              <Input
                id="fechaIngreso"
                type="date"
                value={fechaIngreso}
                onChange={(e) => setFechaIngreso(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Fecha de alta laboral (opcional).
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Especialidades</Label>
            {tipos.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin tipos de dispositivo configurados.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tipos.map((t) => {
                  const active = especialidades.includes(t.codigo)
                  return (
                    <button
                      type="button"
                      key={t.codigo}
                      onClick={() => toggleEspecialidad(t.codigo)}
                      className={cn(
                        "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background hover:bg-muted border-input text-muted-foreground"
                      )}
                    >
                      {active && <Check className="h-3 w-3" />}
                      {t.nombre}
                    </button>
                  )
                })}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Se usan para priorizar asignaciones según el tipo de dispositivo.
            </p>
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
              {loading ? "Guardando..." : isEditing ? "Guardar Cambios" : "Crear Técnico"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
