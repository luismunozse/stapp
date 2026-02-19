"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  X,
  Bug,
  Lightbulb,
  HelpCircle,
  ImagePlus,
  Loader2,
  Trash2,
} from "lucide-react"

interface TicketCreateDialogProps {
  onClose: () => void
  onSuccess: () => void
}

const TIPOS = [
  { value: "BUG", label: "Bug / Error", icon: Bug, description: "Algo no funciona correctamente" },
  { value: "SUGERENCIA", label: "Sugerencia", icon: Lightbulb, description: "Tengo una idea de mejora" },
  { value: "PREGUNTA", label: "Pregunta", icon: HelpCircle, description: "Necesito ayuda o tengo una duda" },
]

export function TicketCreateDialog({ onClose, onSuccess }: TicketCreateDialogProps) {
  const [tipo, setTipo] = useState("")
  const [prioridad, setPrioridad] = useState("MEDIA")
  const [asunto, setAsunto] = useState("")
  const [descripcion, setDescripcion] = useState("")
  const [imagenes, setImagenes] = useState<{ data: string; mime: string; preview: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    const remaining = 3 - imagenes.length
    const filesToAdd = Array.from(files).slice(0, remaining)

    for (const file of filesToAdd) {
      if (file.size > 5 * 1024 * 1024) {
        setError("Las imágenes no pueden superar 5MB")
        return
      }

      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        setImagenes(prev => [...prev, {
          data: dataUrl,
          mime: file.type,
          preview: dataUrl,
        }])
      }
      reader.readAsDataURL(file)
    }

    e.target.value = ""
  }

  const removeImage = (index: number) => {
    setImagenes(prev => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!tipo) {
      setError("Seleccioná un tipo de ticket")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/soporte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          prioridad,
          asunto,
          descripcion,
          imagenes: imagenes.map(img => ({
            data: img.data,
            mime: img.mime,
          })),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Error al crear ticket")
        return
      }

      onSuccess()
    } catch {
      setError("Error al crear ticket")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Nuevo Ticket de Soporte</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Tipo de ticket */}
          <div className="space-y-2">
            <Label>Tipo de consulta *</Label>
            <div className="grid grid-cols-3 gap-2">
              {TIPOS.map((t) => {
                const Icon = t.icon
                const isSelected = tipo === t.value
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTipo(t.value)}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <Icon className={`h-5 w-5 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                    <span className="text-xs font-medium">{t.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Prioridad */}
          <div className="space-y-2">
            <Label>Prioridad</Label>
            <Select value={prioridad} onValueChange={setPrioridad}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BAJA">Baja - No es urgente</SelectItem>
                <SelectItem value="MEDIA">Media - Importante pero no bloquea</SelectItem>
                <SelectItem value="ALTA">Alta - Bloquea mi trabajo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Asunto */}
          <div className="space-y-2">
            <Label htmlFor="asunto">Asunto *</Label>
            <Input
              id="asunto"
              value={asunto}
              onChange={(e) => setAsunto(e.target.value)}
              placeholder="Resumen breve del problema o consulta"
              required
              minLength={5}
              maxLength={200}
            />
          </div>

          {/* Descripción */}
          <div className="space-y-2">
            <Label htmlFor="descripcion">Descripción *</Label>
            <Textarea
              id="descripcion"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Describí en detalle tu consulta, incluyendo pasos para reproducir el error si aplica..."
              rows={5}
              required
              minLength={10}
            />
          </div>

          {/* Imágenes */}
          <div className="space-y-2">
            <Label>Imágenes adjuntas (máx. 3)</Label>
            {imagenes.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {imagenes.map((img, i) => (
                  <div key={img.preview} className="relative group">
                    <img
                      src={img.preview}
                      alt={`Adjunto ${i + 1}`}
                      className="h-20 w-20 object-cover rounded-lg border"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {imagenes.length < 3 && (
              <label className="flex items-center gap-2 p-3 border-2 border-dashed rounded-lg cursor-pointer hover:border-primary/50 transition-colors">
                <ImagePlus className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Agregar imagen ({3 - imagenes.length} restantes)
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading || !tipo || !asunto || !descripcion}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Enviando...
                </>
              ) : (
                "Enviar Ticket"
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
