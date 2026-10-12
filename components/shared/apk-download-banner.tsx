"use client"

import { useState, useEffect, type FormEvent } from "react"
import { Smartphone, X, Loader2, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { isNativePlatform } from "@/lib/capacitor"
import { inscripcionSchema, type Inscripcion } from "@/lib/android-beta"

// Clave nueva a propósito: quien cerró el viejo aviso de "Descargar APK" tiene
// que ver este, que dice otra cosa.
const DISMISS_KEY = "android-beta-banner-dismissed"
// AGREGADO es el único estado accionable (hay una invitación para aceptar): no
// lo puede tapar haber cerrado el aviso de "te anotamos" días atrás. Tiene su
// propia clave para que tampoco moleste para siempre.
const DISMISS_KEY_AGREGADO = "android-beta-banner-dismissed-agregado"
const DISMISS_DURATION_DAYS = 7

const BETA_ENDPOINT = "/api/beta-android"

type Lectura =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; inscripcion: Inscripcion | null }

interface ApkDownloadBannerProps {
  variant: "sidebar" | "top"
}

// localStorage puede faltar o tirar (ventana privada, datos bloqueados): el
// banner tiene que funcionar igual.
function cerradoRecientemente(key: string): boolean {
  try {
    const dismissedAt = localStorage.getItem(key)
    if (!dismissedAt) return false
    const daysSinceDismiss = (Date.now() - parseInt(dismissedAt, 10)) / (1000 * 60 * 60 * 24)
    return daysSinceDismiss < DISMISS_DURATION_DAYS
  } catch {
    return false
  }
}

// Banner de la beta de Android. Conserva el nombre del archivo y del
// componente: lo montan el layout del panel (variant "top") y el navbar
// (variant "sidebar"), y varios tests los mockean por esa ruta.
export function ApkDownloadBanner({ variant }: ApkDownloadBannerProps) {
  // Se decide en el efecto (localStorage y Capacitor no existen en el servidor).
  const [habilitado, setHabilitado] = useState(false)
  const [cerrado, setCerrado] = useState({ general: true, agregado: true })
  const [lectura, setLectura] = useState<Lectura>({ status: "loading" })
  const [editando, setEditando] = useState(false)
  const [email, setEmail] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [errorForm, setErrorForm] = useState<string | null>(null)

  useEffect(() => {
    // En la app nativa no se muestra ni se consulta. Fuera de ella se consulta
    // aunque lo haya cerrado: qué clave de cierre manda depende del estado.
    if (isNativePlatform()) {
      setHabilitado(false)
      return
    }
    setCerrado({
      general: cerradoRecientemente(DISMISS_KEY),
      agregado: cerradoRecientemente(DISMISS_KEY_AGREGADO),
    })
    setHabilitado(true)

    let cancelado = false
    fetch(BETA_ENDPOINT)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { inscripcion: Inscripcion | null }) => {
        if (!cancelado) setLectura({ status: "ready", inscripcion: data.inscripcion ?? null })
      })
      // Un fallo no puede romper el layout: el banner simplemente no aparece.
      .catch(() => {
        if (!cancelado) setLectura({ status: "error" })
      })
    return () => {
      cancelado = true
    }
  }, [])

  if (!habilitado || lectura.status !== "ready") return null

  // DESCARTADO se trata como si nunca se hubiera anotado.
  const inscripcion =
    lectura.inscripcion && lectura.inscripcion.estado !== "DESCARTADO" ? lectura.inscripcion : null
  const esAgregado = inscripcion?.estado === "AGREGADO"

  if (esAgregado ? cerrado.agregado : cerrado.general) return null

  const handleDismiss = () => {
    try {
      localStorage.setItem(esAgregado ? DISMISS_KEY_AGREGADO : DISMISS_KEY, Date.now().toString())
    } catch {
      // sin storage: se oculta igual en esta sesión
    }
    setCerrado((prev) => (esAgregado ? { ...prev, agregado: true } : { ...prev, general: true }))
  }
  const mostrarFormulario = !inscripcion || editando

  const empezarEdicion = () => {
    setEmail(inscripcion?.email ?? "")
    setErrorForm(null)
    setEditando(true)
  }

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    const parsed = inscripcionSchema.safeParse({ email })
    if (!parsed.success) {
      setErrorForm("Revisá que el correo esté bien escrito.")
      return
    }
    setEnviando(true)
    setErrorForm(null)
    try {
      const res = await fetch(BETA_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: parsed.data.email }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const data: { inscripcion: Inscripcion } = await res.json()
      setLectura({ status: "ready", inscripcion: data.inscripcion })
      setEditando(false)
    } catch {
      setErrorForm("No pudimos anotarte. Probá de nuevo en un rato.")
    } finally {
      setEnviando(false)
    }
  }

  const cuerpo = mostrarFormulario ? (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-foreground leading-tight">
        {editando ? "Cambiá tu correo de Google" : "Sumate a la beta de Android"}
      </p>
      {!editando && (
        <p className="text-[11px] text-muted-foreground leading-snug">Probá la app antes que nadie</p>
      )}
      <form onSubmit={enviar} noValidate className="space-y-1.5">
        <Input
          type="email"
          inputMode="email"
          autoComplete="email"
          aria-label="Tu cuenta de Google del celular"
          placeholder="Tu cuenta de Google del celular"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={enviando}
          className="h-8 text-xs"
        />
        {errorForm && (
          <p role="alert" className="text-[11px] text-destructive leading-snug">
            {errorForm}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground leading-snug">
          Tiene que ser el mismo correo con el que entrás a Play Store en tu celular.
        </p>
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" className="h-7 text-xs" disabled={enviando}>
            {enviando && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Sumarme
          </Button>
          {editando && (
            <button
              type="button"
              onClick={() => setEditando(false)}
              className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Cancelar
            </button>
          )}
        </div>
      </form>
    </div>
  ) : inscripcion.estado === "AGREGADO" ? (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-foreground leading-tight">¡Ya estás adentro!</p>
      <p className="text-[11px] text-muted-foreground leading-snug">
        Aceptá la invitación y después instalá STApp desde Play Store.
      </p>
      <Button asChild size="sm" className="h-7 text-xs">
        <a href={inscripcion.linkInvitacion} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="h-3 w-3 mr-1" />
          Aceptar invitación
        </a>
      </Button>
    </div>
  ) : (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-foreground leading-tight">Beta de Android</p>
      <p className="text-[11px] text-muted-foreground leading-snug">
        {`Te anotamos con ${inscripcion.email}. Te avisamos acá cuando esté lista tu invitación.`}
      </p>
      <button
        type="button"
        onClick={empezarEdicion}
        className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        cambiar correo
      </button>
    </div>
  )

  if (variant === "sidebar") {
    return (
      <div className="mx-3 mb-2 p-3 rounded-lg bg-primary/5 border border-primary/20 relative">
        <button
          onClick={handleDismiss}
          className="absolute top-1.5 right-1.5 p-0.5 rounded-full hover:bg-primary/10 transition-colors text-muted-foreground hover:text-foreground"
          aria-label="Cerrar"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <div className="flex items-start gap-2.5 pr-4">
          <Smartphone className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">{cuerpo}</div>
        </div>
      </div>
    )
  }

  // variant === "top"
  return (
    <div className="lg:hidden fixed top-[calc(3.5rem+env(safe-area-inset-top,0px))] left-0 right-0 z-40 flex justify-center px-2">
      <div className="relative w-full max-w-sm rounded-xl border border-primary/20 bg-card p-3 shadow-lg">
        <button
          onClick={handleDismiss}
          className="absolute top-1.5 right-1.5 p-1 rounded-full hover:bg-primary/10 transition-colors text-muted-foreground hover:text-foreground"
          aria-label="Cerrar aviso"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <div className="flex items-start gap-2.5 pr-5">
          <Smartphone className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">{cuerpo}</div>
        </div>
      </div>
    </div>
  )
}
