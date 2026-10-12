"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight, Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { compressImageToDataUrl } from "@/lib/images/compress-image"
import { RubroSelector } from "./rubro-selector"
import type { RubroVigente } from "./types"

const MAX_LOGO_BYTES = 5 * 1024 * 1024

interface NegocioStepProps {
  nombre: string
  onNombreChange: (nombre: string) => void
  logoFile: File | null
  logoPreview: string | null
  onLogoChange: (file: File | null, preview: string | null) => void
  rubro: RubroVigente
  rubroBloqueado: boolean
  onRubroGuardado: (rubro: RubroVigente) => void
  onRubroBloqueado: () => void
  /** router.refresh() is bringing the new tipos and vocabulary after a rubro change. */
  actualizando: boolean
  onAtras: () => void
  onGuardado: () => void
}

export function NegocioStep({
  nombre,
  onNombreChange,
  logoFile,
  logoPreview,
  onLogoChange,
  rubro,
  rubroBloqueado,
  onRubroGuardado,
  onRubroBloqueado,
  actualizando,
  onAtras,
  onGuardado,
}: NegocioStepProps) {
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const file = input.files?.[0]
    // Reset so picking the same file again still fires onChange.
    const resetInput = () => {
      input.value = ""
    }
    if (!file) return

    const rejectFile = (message: string) => {
      // Drop any previously picked logo: it must not be uploaded after an invalid pick.
      onLogoChange(null, null)
      setError(message)
      resetInput()
    }

    if (!file.type.startsWith("image/")) {
      rejectFile("Elegí una imagen válida.")
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      rejectFile("La imagen es demasiado grande (máximo 5MB).")
      return
    }

    setError(null)
    onLogoChange(file, URL.createObjectURL(file))
    resetInput()
  }

  // Single save (#443): name and, only if a new file was picked, logo.
  const handleSiguiente = async () => {
    const nombreEmpresa = nombre.trim()
    if (!nombreEmpresa && !logoFile) {
      onGuardado()
      return
    }
    setGuardando(true)
    setError(null)
    try {
      const payload: Record<string, string> = {}
      if (nombreEmpresa) payload.nombreEmpresa = nombreEmpresa
      if (logoFile) {
        let dataUrl: string
        try {
          dataUrl = await compressImageToDataUrl(logoFile)
        } catch (err) {
          console.error("Error compressing logo:", err)
          setError("No pudimos leer la imagen. Probá con un PNG o JPG.")
          return
        }
        const [header, data] = dataUrl.split(",")
        payload.logoData = data
        payload.logoMime = header.split(":")[1].split(";")[0]
      }

      const res = await fetch("/api/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error || "No pudimos guardar los datos. Probá de nuevo.")
        return
      }

      await fetch("/api/onboarding/progress", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_logo: true }),
      })
      onGuardado()
    } catch (err) {
      console.error("Error saving business data:", err)
      setError("No pudimos guardar los datos. Revisá tu conexión y probá de nuevo.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
      <CardHeader>
        <CardTitle data-paso-titulo tabIndex={-1} className="flex items-center gap-2 outline-none">
          <Upload className="h-5 w-5 text-blue-600" aria-hidden="true" />
          Personalizá tu negocio
        </CardTitle>
        <CardDescription>Así te ven tus clientes en los avisos y en los comprobantes.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="negocio-nombre">Nombre de tu negocio</Label>
          <Input
            id="negocio-nombre"
            value={nombre}
            onChange={(e) => onNombreChange(e.target.value)}
            placeholder="Ej: Service Rodríguez"
            autoComplete="organization"
            disabled={guardando}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="negocio-logo">Logo (opcional)</Label>
          <input
            id="negocio-logo"
            type="file"
            accept="image/*"
            onChange={handleLogoFileChange}
            disabled={guardando}
            className="block w-full rounded-md text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 dark:file:bg-blue-900 dark:file:text-blue-300"
          />
          {logoPreview && (
            <img src={logoPreview} alt="Vista previa del logo" className="mt-3 h-16 w-auto rounded object-contain" />
          )}
        </div>
        <RubroSelector
          rubro={rubro.rubro}
          rubroDetalle={rubro.rubroDetalle}
          bloqueado={rubroBloqueado}
          deshabilitado={guardando}
          onGuardado={onRubroGuardado}
          onBloqueado={onRubroBloqueado}
        />
        {error && (
          <div role="alert" className="rounded border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="flex flex-col gap-2 pt-4 sm:flex-row-reverse sm:justify-between">
          <Button onClick={() => void handleSiguiente()} disabled={guardando || actualizando}>
            {(guardando || actualizando) && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {actualizando ? "Actualizando…" : guardando ? "Guardando…" : "Siguiente"}
            {!actualizando && !guardando && <ChevronRight className="ml-2 h-4 w-4" aria-hidden="true" />}
          </Button>
          <Button variant="ghost" onClick={onAtras} disabled={guardando}>
            <ChevronLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            Atrás
          </Button>
        </div>
      </CardContent>
    </>
  )
}
