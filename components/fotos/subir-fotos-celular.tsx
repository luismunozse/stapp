"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { AlertCircle, Camera, CheckCircle2, Images, Loader2, RefreshCw } from "lucide-react"
import { compressImage } from "@/lib/image-compression"

interface Sesion {
  orden: { codigo: string | null; dispositivo: string | null }
  organizacion: string
  expiresAt: string
  fotosSubidas: number
  maxFotos: number
}

interface Subida {
  id: string
  preview: string
  /** Se conserva para poder reintentar. */
  file: File
  estado: "subiendo" | "ok" | "error"
  error?: string
}

const MIMES = ["image/jpeg", "image/png", "image/webp"]

const leerComoDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () =>
      typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("lectura"))
    reader.onerror = () => reject(new Error("lectura"))
    reader.readAsDataURL(file)
  })

/** Las fotos del iPhone pueden venir en HEIC: se pasan a JPEG para que el servidor las acepte. */
async function aJpeg(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0)
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9))
  if (!blob) throw new Error("conversion")
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" })
}

/**
 * Pantalla que abre el celular al escanear el QR de la orden: saca o elige
 * fotos y las sube con el enlace temporal. No requiere login.
 */
export function SubirFotosCelular({ token }: { token: string }) {
  const [sesion, setSesion] = useState<Sesion | null>(null)
  const [cargando, setCargando] = useState(true)
  const [invalido, setInvalido] = useState<string | null>(null)
  const [subidas, setSubidas] = useState<Subida[]>([])
  const camaraRef = useRef<HTMLInputElement>(null)
  const galeriaRef = useRef<HTMLInputElement>(null)
  // Las fotos se suben de a una, en orden.
  const cola = useRef<Promise<void>>(Promise.resolve())

  const api = `/api/public/fotos-celular/${encodeURIComponent(token)}`

  useEffect(() => {
    let vigente = true
    fetch(api)
      .then(async (res) => {
        const data = await res.json().catch(() => null)
        if (!vigente) return
        if (!res.ok) setInvalido(data?.error || "El enlace no es válido.")
        else setSesion(data)
      })
      .catch(() => vigente && setInvalido("No se pudo conectar. Revisá tu conexión y volvé a escanear el código."))
      .finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
  }, [api])

  // Cuando vence, la pantalla lo dice sin esperar a que falle una subida.
  useEffect(() => {
    if (!sesion) return
    const ms = new Date(sesion.expiresAt).getTime() - Date.now()
    const timer = setTimeout(
      () => setInvalido("El enlace venció. Generá uno nuevo desde la computadora."),
      Math.max(0, ms)
    )
    return () => clearTimeout(timer)
  }, [sesion])

  const marcar = (id: string, cambios: Partial<Subida>) =>
    setSubidas((prev) => prev.map((s) => (s.id === id ? { ...s, ...cambios } : s)))

  const subir = useCallback(
    async (id: string, file: File) => {
      try {
        const normalizada = MIMES.includes(file.type) ? file : await aJpeg(file)
        const dataUrl = await leerComoDataUrl(await compressImage(normalizada))
        const match = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/)
        if (!match) throw new Error("formato")

        const res = await fetch(api, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mime: match[1], data: match[2] }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => null)
          const mensaje = data?.error || "No se pudo subir"
          marcar(id, { estado: "error", error: mensaje })
          // 404 = el enlace dejó de servir (venció, se cerró el QR o se llenó el cupo).
          if (res.status === 404) setInvalido(mensaje)
          return
        }
        marcar(id, { estado: "ok", error: undefined })
      } catch {
        marcar(id, { estado: "error", error: "No se pudo subir. Tocá para reintentar." })
      }
    },
    [api]
  )

  const encolar = (id: string, file: File) => {
    cola.current = cola.current.then(() => subir(id, file))
  }

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ""
    if (files.length === 0) return
    const nuevas: Subida[] = files.map((file) => ({
      id: Math.random().toString(36).slice(2, 11),
      preview: URL.createObjectURL(file),
      file,
      estado: "subiendo",
    }))
    setSubidas((prev) => [...prev, ...nuevas])
    nuevas.forEach((s) => encolar(s.id, s.file))
  }

  const reintentar = (s: Subida) => {
    marcar(s.id, { estado: "subiendo", error: undefined })
    encolar(s.id, s.file)
  }

  if (cargando) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Cargando...
      </div>
    )
  }

  const listas = subidas.filter((s) => s.estado === "ok").length
  const enCurso = subidas.some((s) => s.estado === "subiendo")
  const restantes = sesion ? Math.max(0, sesion.maxFotos - sesion.fotosSubidas - listas) : 0

  return (
    <div className="space-y-4">
      {sesion && (
        <header className="text-center space-y-1">
          <p className="text-sm text-muted-foreground">{sesion.organizacion}</p>
          <h1 className="text-xl font-semibold">
            Fotos de la orden {sesion.orden.codigo ?? ""}
          </h1>
          {sesion.orden.dispositivo && (
            <p className="text-sm text-muted-foreground">{sesion.orden.dispositivo}</p>
          )}
        </header>
      )}

      {invalido ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="font-medium">{invalido}</p>
            {listas > 0 && (
              <p className="text-sm text-muted-foreground">
                {listas === 1 ? "La foto que subiste ya está" : `Las ${listas} fotos que subiste ya están`} en la orden.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <input
            ref={camaraRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFiles}
            className="hidden"
          />
          <input
            ref={galeriaRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFiles}
            className="hidden"
          />
          <div className="grid gap-2">
            <Button
              type="button"
              size="lg"
              className="h-14 text-base"
              disabled={restantes === 0}
              onClick={() => camaraRef.current?.click()}
            >
              <Camera className="mr-2 h-5 w-5" />
              Tomar foto
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="h-12"
              disabled={restantes === 0}
              onClick={() => galeriaRef.current?.click()}
            >
              <Images className="mr-2 h-5 w-5" />
              Elegir de la galería
            </Button>
          </div>
          <p className="text-center text-sm text-muted-foreground" aria-live="polite">
            {enCurso
              ? "Subiendo..."
              : listas > 0
                ? `${listas === 1 ? "1 foto subida" : `${listas} fotos subidas`}. Ya ${listas === 1 ? "aparece" : "aparecen"} en la computadora.`
                : "Las fotos aparecen en la computadora a medida que las subís."}
            {restantes === 0 && " Llegaste al máximo de fotos de este enlace."}
          </p>
        </>
      )}

      {subidas.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {subidas.map((s) => (
            <div key={s.id} className="relative aspect-square overflow-hidden rounded-lg border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.preview} alt="Foto" className="h-full w-full object-cover" />
              {s.estado === "subiendo" && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              )}
              {s.estado === "ok" && (
                <CheckCircle2 className="absolute bottom-1 right-1 h-6 w-6 rounded-full bg-background text-success" />
              )}
              {s.estado === "error" && (
                <button
                  type="button"
                  disabled={!!invalido}
                  onClick={() => reintentar(s)}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-destructive/80 p-1 text-center text-xs text-white"
                >
                  <RefreshCw className="h-5 w-5" />
                  {s.error}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
