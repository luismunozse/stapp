"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useRouter } from "next/navigation"
import {
  X, Plus, Minus, Trash2, ShoppingCart, Loader2, CheckCircle2,
  ImagePlus, MessageSquare, Camera, Ticket, AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import type { useCart } from "./use-cart"
import { useCupon } from "./use-cupon"
import { useCatalogoUpload } from "./use-catalogo-upload"
import { catalogoWhatsAppUrl } from "@/lib/catalogo/whatsapp"
import { construirMensajePedidoWhatsApp, NOTAS_PEDIDO_MAX } from "@/lib/catalogo/pedido-whatsapp"

interface Props {
  open: boolean
  onClose: () => void
  cart: ReturnType<typeof useCart>
  slug: string
  titulo: string
  formatPrecio: (n: number) => string
  brandColor: string
  /** false = el plan no registra pedidos: el checkout solo arma el mensaje de WhatsApp. */
  recibePedidos?: boolean
  /** WhatsApp del taller ya normalizado (con código de país), o null. */
  whatsapp?: string | null
}

const MAX_ADJUNTOS_POR_ITEM = 3

type ItemExtras = { comentario: string; adjuntos: string[] }

export function CartDrawer({ open, onClose, cart, slug, titulo, formatPrecio, brandColor, recibePedidos = true, whatsapp = null }: Props) {
  const router = useRouter()
  // El server rechaza /cotizar con FEATURE_REQUIRED si el plan cambió después de
  // cachear la página: desde ahí el carrito se comporta como el de un plan sin pedidos.
  const [planSinPedidos, setPlanSinPedidos] = useState(false)
  const soloWhatsapp = !recibePedidos || planSinPedidos
  // URL del pedido ya abierto en WhatsApp. El carrito NO se vacía al abrirlo:
  // window.open con noopener devuelve null siempre, no hay forma de saber si el
  // popup se bloqueó o si el visitante mandó el mensaje.
  const [waEnviado, setWaEnviado] = useState<string | null>(null)
  const sinCanalDePedido = soloWhatsapp && !catalogoWhatsAppUrl(whatsapp)
  const [step, setStep] = useState<"cart" | "checkout">("cart")
  const [submitting, setSubmitting] = useState(false)

  const [nombre, setNombre] = useState("")
  const [telefono, setTelefono] = useState("")
  const [email, setEmail] = useState("")
  const [notas, setNotas] = useState("")
  const [extras, setExtras] = useState<Record<string, ItemExtras>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const fileInputsRef = useRef<Record<string, HTMLInputElement | null>>({})

  // Cupón + upload encapsulados en hooks; reusables y testeables aparte.
  const getSubtotalCb = useCallback(() => cart.total, [cart.total])
  const cupon = useCupon(slug, getSubtotalCb)
  const { upload: uploadFile, uploadingItem } = useCatalogoUpload(slug)

  // Aliases para minimizar cambios en JSX existente.
  const cuponInput = cupon.input
  const setCuponInput = cupon.setInput
  const cuponAplicado = cupon.aplicado
  const cuponError = cupon.error
  const validatingCupon = cupon.validating
  const aplicarCupon = cupon.aplicar
  const quitarCupon = cupon.quitar

  // Consent de privacidad (Ley 25.326 / GDPR-like): el cliente debe aceptar
  // explícitamente que sus datos se usen para contactarlo. Sin esto, no se
  // envía la solicitud ni se snapshota el carrito como abandonado.
  const [consent, setConsent] = useState(false)
  const abandonoLastSentRef = useRef<string>("")

  const totalConCupon = Math.max(0, cart.total - (cuponAplicado?.descuento ?? 0))

  // Auto-snapshot del carrito como "abandonado" cuando el visitante ya completó
  // nombre + teléfono pero todavía no apretó Enviar. Sirve para que el admin
  // pueda contactarlo por WhatsApp si no termina el flujo.
  useEffect(() => {
    if (!open) return
    // Sin pedidos registrados no guardamos nada del visitante, tampoco el abandono.
    if (soloWhatsapp) return
    if (step !== "checkout") return
    if (cart.items.length === 0) return
    // Sin consent explícito no snapshoteamos PII (compliance Ley 25.326).
    if (!consent) return
    const n = nombre.trim()
    const t = telefono.trim()
    if (n.length < 2 || t.length < 4) return

    const payload = {
      cliente: { nombre: n, telefono: t, email: email.trim() || undefined },
      items: cart.items.map((i) => ({
        itemId: i.id,
        varianteId: i.varianteId ?? null,
        varianteEtiqueta: i.varianteEtiqueta ?? null,
        nombre: i.nombre,
        cantidad: i.cantidad,
        precioUnitario: i.precio,
        imagen_url: i.imagen_url ?? null,
      })),
      total: totalConCupon,
      cuponCodigo: cuponAplicado?.codigo,
      consent: true,
    }
    const payloadKey = JSON.stringify(payload)
    if (abandonoLastSentRef.current === payloadKey) return

    const timer = setTimeout(() => {
      abandonoLastSentRef.current = payloadKey
      fetch(`/api/public/catalogo/${slug}/abandono`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payloadKey,
        keepalive: true,
      }).catch(() => {
        abandonoLastSentRef.current = ""
      })
    }, 1500)

    return () => clearTimeout(timer)
  }, [open, soloWhatsapp, step, consent, nombre, telefono, email, cart.items, totalConCupon, cuponAplicado, slug])

  const getExtras = (id: string): ItemExtras => extras[id] ?? { comentario: "", adjuntos: [] }

  const setExtra = (id: string, patch: Partial<ItemExtras>) => {
    setExtras((prev) => {
      const curr = prev[id] ?? { comentario: "", adjuntos: [] }
      return { ...prev, [id]: { ...curr, ...patch } }
    })
  }

  const handleUpload = async (itemId: string, file: File) => {
    const url = await uploadFile(itemId, file)
    if (!url) return
    const current = getExtras(itemId).adjuntos
    setExtra(itemId, { adjuntos: [...current, url].slice(0, MAX_ADJUNTOS_POR_ITEM) })
  }

  const removeAdjunto = (itemId: string, url: string) => {
    const current = getExtras(itemId).adjuntos
    setExtra(itemId, { adjuntos: current.filter((u) => u !== url) })
  }

  // Todo síncrono a propósito: window.open tiene que correr en el mismo tick del
  // click o Safari/iOS lo bloquea como popup.
  const handleEnviarWhatsApp = () => {
    const texto = construirMensajePedidoWhatsApp({
      taller: titulo,
      cliente: nombre,
      items: cart.items,
      total: cart.total,
      notas,
      formatPrecio,
    })
    const url = catalogoWhatsAppUrl(whatsapp, texto)
    if (!url || cart.items.length === 0) return
    window.open(url, "_blank", "noopener,noreferrer")
    setWaEnviado(url)
  }

  const confirmarEnvio = () => {
    cart.clear()
    setExtras({})
    setStep("cart")
    setWaEnviado(null)
    onClose()
  }

  const handleSubmit = async () => {
    if (soloWhatsapp) return handleEnviarWhatsApp()
    if (!nombre.trim() || !telefono.trim()) {
      toast.error("Nombre y teléfono son obligatorios")
      return
    }
    if (!consent) {
      toast.error("Necesitás aceptar el uso de tus datos para enviar la solicitud")
      return
    }
    if (cart.items.length === 0) return

    setSubmitting(true)
    try {
      const res = await fetch(`/api/public/catalogo/${slug}/cotizar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente: { nombre: nombre.trim(), telefono: telefono.trim(), email: email.trim() || undefined },
          notas: notas.trim() || undefined,
          cuponCodigo: cuponAplicado?.codigo,
          consent: true,
          items: cart.items.map((i) => {
            const k = cart.cartKey(i)
            const ex = extras[k]
            return {
              itemId: i.id,
              varianteId: i.varianteId ?? undefined,
              cantidad: i.cantidad,
              comentario: ex?.comentario?.trim() || undefined,
              adjuntos: ex?.adjuntos?.length ? ex.adjuntos : undefined,
            }
          }),
        }),
      })
      const data = await res.json()
      if (res.status === 403 && data.code === "FEATURE_REQUIRED") {
        setPlanSinPedidos(true)
        toast.error(
          catalogoWhatsAppUrl(whatsapp)
            ? "Este catálogo ahora recibe pedidos solo por WhatsApp. Revisá tu pedido y envialo desde ahí."
            : "Este catálogo no está tomando pedidos online por el momento."
        )
        return
      }
      if (!res.ok) throw new Error(data.error || "Error al enviar")
      cart.clear()
      setExtras({})
      toast.success("¡Solicitud enviada!")
      // Abrir WhatsApp del taller en nueva pestaña con resumen para que el
      // mensaje llegue a su canal. Está dentro del gesture del submit → no lo
      // bloquea el popup blocker. Si la org no tiene WA configurado, omite.
      if (data.whatsappTallerUrl) {
        try {
          window.open(data.whatsappTallerUrl, "_blank", "noopener,noreferrer")
        } catch {
          /* ignore */
        }
      }
      router.push(data.url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al enviar")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="fixed right-0 top-0 bottom-0 z-50 w-full sm:max-w-md bg-background shadow-2xl flex flex-col pb-[env(safe-area-inset-bottom,0px)]"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            <header className="border-b">
              <div className="flex items-center justify-between p-4">
                <h2 className="font-semibold flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5" />
                  {step === "cart" ? "Tu solicitud" : "Tus datos"}
                </h2>
                <Button variant="ghost" size="icon" onClick={onClose} className="h-10 w-10">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {cart.items.length > 0 && (
                <ol className="px-4 pb-3 flex items-center gap-2 text-xs">
                  <li className="flex items-center gap-1.5 font-semibold" style={{ color: brandColor }}>
                    <span
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-white text-[10px] font-bold"
                      style={{ backgroundColor: brandColor }}
                    >
                      {step === "cart" ? "1" : <CheckCircle2 className="h-3 w-3" />}
                    </span>
                    Carrito
                  </li>
                  <li
                    className="h-px flex-1 transition-colors"
                    style={{ backgroundColor: step === "checkout" ? brandColor : "var(--border)" }}
                  />
                  <li
                    className={`flex items-center gap-1.5 ${
                      step === "checkout" ? "font-semibold" : "text-muted-foreground"
                    }`}
                    style={{ color: step === "checkout" ? brandColor : undefined }}
                  >
                    <span
                      className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                        step === "checkout" ? "text-white" : "bg-muted text-muted-foreground"
                      }`}
                      style={step === "checkout" ? { backgroundColor: brandColor } : undefined}
                    >
                      2
                    </span>
                    Tus datos
                  </li>
                </ol>
              )}
            </header>

            <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom,1rem)]">
              {waEnviado ? (
                <div className="p-6 text-center space-y-4">
                  <CheckCircle2 className="h-10 w-10 mx-auto" style={{ color: brandColor }} />
                  <p className="font-medium">Abrimos WhatsApp con tu pedido</p>
                  <p className="text-sm text-muted-foreground">
                    Enviá el mensaje desde WhatsApp. Si no se abrió, tocá el botón. Tu carrito sigue acá hasta que confirmes.
                  </p>
                  <Button asChild className="w-full h-12" style={{ backgroundColor: brandColor }}>
                    <a href={waEnviado} target="_blank" rel="noopener noreferrer">Volver a abrir WhatsApp</a>
                  </Button>
                  <Button variant="outline" onClick={confirmarEnvio} className="w-full h-12">
                    Ya lo envié, vaciar carrito
                  </Button>
                  <Button variant="ghost" onClick={() => setWaEnviado(null)} className="w-full">
                    Modificar pedido
                  </Button>
                </div>
              ) : step === "cart" ? (
                cart.items.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-6 text-center">
                    <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center mb-4">
                      <ShoppingCart className="h-10 w-10 opacity-40" />
                    </div>
                    <p className="font-medium text-foreground mb-1">Tu carrito está vacío</p>
                    <p className="text-sm mb-5">Explorá el catálogo y agregá items para solicitar tu presupuesto.</p>
                    <Button
                      onClick={onClose}
                      className="gap-1.5"
                      style={{ backgroundColor: brandColor }}
                    >
                      Volver al catálogo
                    </Button>
                  </div>
                ) : (
                  <div className="p-4 space-y-3">
                    {cart.items.map((item) => {
                      const k = cart.cartKey(item)
                      const ex = getExtras(k)
                      const hasExtras = ex.comentario.length > 0 || ex.adjuntos.length > 0
                      const isExpanded = expanded[k] || hasExtras
                      const isUploading = uploadingItem === k
                      return (
                        <div key={k} className="border rounded-lg p-2.5 space-y-2">
                          <div className="flex gap-3">
                            <div className="w-16 h-16 rounded-md bg-muted overflow-hidden shrink-0 border">
                              {item.imagen_url && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={item.imagen_url}
                                  alt={item.nombre}
                                  loading="lazy"
                                  decoding="async"
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="text-sm font-medium line-clamp-2 leading-snug">{item.nombre}</h3>
                              {item.varianteEtiqueta && (
                                <p className="text-xs text-muted-foreground">{item.varianteEtiqueta}</p>
                              )}
                              <div className="text-sm font-bold mt-0.5" style={{ color: brandColor }}>
                                {formatPrecio(item.precio * item.cantidad)}
                              </div>
                              <div className="inline-flex items-center rounded-md border bg-background overflow-hidden mt-1.5">
                                <button
                                  type="button"
                                  onClick={() => cart.setCantidad(k, item.cantidad - 1)}
                                  className="h-9 w-9 inline-flex items-center justify-center hover:bg-muted active:scale-95 transition disabled:opacity-40"
                                  aria-label="Disminuir"
                                >
                                  <Minus className="h-3.5 w-3.5" />
                                </button>
                                <span className="w-9 text-center text-sm font-semibold tabular-nums">{item.cantidad}</span>
                                <button
                                  type="button"
                                  onClick={() => cart.setCantidad(k, item.cantidad + 1)}
                                  disabled={item.stock_disponible != null && item.cantidad >= item.stock_disponible}
                                  className="h-9 w-9 inline-flex items-center justify-center hover:bg-muted active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
                                  aria-label="Aumentar"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => cart.remove(k)}
                              className="h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition shrink-0"
                              aria-label="Quitar"
                              title="Quitar del carrito"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>

                          {soloWhatsapp ? null : !isExpanded ? (
                            <button
                              type="button"
                              onClick={() => setExpanded((prev) => ({ ...prev, [k]: true }))}
                              className="w-full text-left text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 transition-colors px-1 py-1 -mx-1 rounded"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                              <span>Agregar comentario o foto</span>
                              <span className="ml-auto text-[10px] opacity-60">opcional</span>
                            </button>
                          ) : (
                            <div className="space-y-2 pt-2 border-t">
                              <Textarea
                                value={ex.comentario}
                                onChange={(e) => setExtra(k, { comentario: e.target.value })}
                                rows={2}
                                maxLength={500}
                                placeholder="Detalles del item (ej: pantalla rota lado superior, talle XL)"
                                className="text-xs resize-none"
                              />
                              <div className="flex flex-wrap gap-1.5 items-center">
                                {ex.adjuntos.map((url) => (
                                  <div key={url} className="relative h-12 w-12 rounded-md overflow-hidden border group/img">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={url} alt="" className="w-full h-full object-cover" />
                                    <button
                                      type="button"
                                      onClick={() => removeAdjunto(k, url)}
                                      className="absolute inset-0 bg-black/60 sm:opacity-0 sm:group-hover/img:opacity-100 flex items-center justify-center transition-opacity"
                                      aria-label="Quitar foto"
                                    >
                                      <X className="h-3.5 w-3.5 text-white" />
                                    </button>
                                  </div>
                                ))}
                                {ex.adjuntos.length < MAX_ADJUNTOS_POR_ITEM && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => fileInputsRef.current[k]?.click()}
                                      disabled={isUploading}
                                      className="inline-flex items-center gap-1 h-9 px-2.5 rounded-md border border-dashed text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors disabled:opacity-50 active:scale-95"
                                      aria-label="Agregar foto"
                                    >
                                      {isUploading ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Camera className="h-3.5 w-3.5" />
                                      )}
                                      <span>{ex.adjuntos.length === 0 ? "Agregar foto" : "Otra"}</span>
                                    </button>
                                    <input
                                      ref={(el) => {
                                        fileInputsRef.current[k] = el
                                      }}
                                      type="file"
                                      accept="image/jpeg,image/png,image/webp"
                                      capture="environment"
                                      className="hidden"
                                      onChange={(e) => {
                                        const f = e.target.files?.[0]
                                        if (f) handleUpload(k, f)
                                        e.target.value = ""
                                      }}
                                    />
                                  </>
                                )}
                              </div>
                              {ex.adjuntos.length === 0 && (
                                <p className="text-[10px] text-muted-foreground">
                                  Hasta {MAX_ADJUNTOS_POR_ITEM} fotos · máx 4MB c/u
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              ) : (
                <div className="p-4 space-y-3">
                  <div className="rounded-lg bg-muted/40 p-3 text-sm space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Items</span>
                      <span>{cart.count}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>{formatPrecio(cart.total)}</span>
                    </div>
                    {cuponAplicado && (
                      <div className="flex items-center justify-between text-green-700 dark:text-green-400">
                        <span className="inline-flex items-center gap-1">
                          <Ticket className="h-3.5 w-3.5" />
                          {cuponAplicado.codigo}
                        </span>
                        <span>− {formatPrecio(cuponAplicado.descuento)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between font-semibold pt-1 border-t">
                      <span>Total estimado</span>
                      <span style={{ color: brandColor }}>{formatPrecio(totalConCupon)}</span>
                    </div>
                  </div>

                  {soloWhatsapp ? null : (
                  <div>
                    <Label htmlFor="cupon" className="flex items-center gap-1.5">
                      <Ticket className="h-3.5 w-3.5" />
                      Cupón de descuento
                    </Label>
                    {cuponAplicado ? (
                      <div className="mt-1 flex items-center justify-between rounded-md border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 px-3 py-2">
                        <span className="font-mono text-sm font-semibold text-green-800 dark:text-green-300">
                          {cuponAplicado.codigo}
                        </span>
                        <Button type="button" variant="ghost" size="sm" onClick={quitarCupon} className="h-7 text-xs">
                          Quitar
                        </Button>
                      </div>
                    ) : (
                      <div className="mt-1 flex gap-1.5">
                        <Input
                          id="cupon"
                          value={cuponInput}
                          onChange={(e) => {
                            setCuponInput(e.target.value.toUpperCase())
                          }}
                          placeholder="Ej: VERANO25"
                          className="font-mono uppercase"
                          maxLength={32}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault()
                              aplicarCupon()
                            }
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={aplicarCupon}
                          disabled={validatingCupon || !cuponInput.trim()}
                          className="gap-1.5 shrink-0"
                        >
                          {validatingCupon && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          Aplicar
                        </Button>
                      </div>
                    )}
                    {cuponError && (
                      <p className="text-xs text-destructive mt-1 inline-flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {cuponError}
                      </p>
                    )}
                  </div>
                  )}

                  <div>
                    <Label htmlFor="nombre">{soloWhatsapp ? "Tu nombre (opcional)" : "Nombre completo *"}</Label>
                    <Input
                      id="nombre"
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                      maxLength={120}
                      autoComplete="name"
                      placeholder="Ej: Juan Pérez"
                      className="h-11 mt-1"
                    />
                  </div>
                  {soloWhatsapp ? null : (<>
                  <div>
                    <Label htmlFor="telefono">Teléfono / WhatsApp *</Label>
                    <Input
                      id="telefono"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={telefono}
                      onChange={(e) => setTelefono(e.target.value)}
                      maxLength={40}
                      placeholder="+54 9 11 1234-5678"
                      className="h-11 mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="email">Email (opcional)</Label>
                    <Input
                      id="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="tu@correo.com"
                      className="h-11 mt-1"
                    />
                  </div>
                  </>)}
                  <div>
                    <Label htmlFor="notas">Notas (opcional)</Label>
                    <Textarea
                      id="notas"
                      value={notas}
                      onChange={(e) => setNotas(e.target.value)}
                      rows={3}
                      maxLength={soloWhatsapp ? NOTAS_PEDIDO_MAX : 1000}
                      placeholder="Algún detalle que quieras compartir..."
                      className="mt-1"
                    />
                  </div>

                  {soloWhatsapp ? (
                    <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 p-3 text-xs text-blue-900 dark:text-blue-200 flex gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>
                        Tu pedido se envía por WhatsApp a {titulo}. No queda registrado en el catálogo ni reserva
                        stock: confirmá disponibilidad y precio por el chat.
                      </span>
                    </div>
                  ) : (<>
                  <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 p-3 text-xs text-blue-900 dark:text-blue-200 flex gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>Esta solicitud genera un presupuesto en {titulo}. Te van a contactar para confirmar.</span>
                  </div>

                  <label className="flex gap-2 items-start text-xs text-muted-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-current cursor-pointer"
                      style={{ accentColor: brandColor }}
                      aria-describedby="consent-help"
                    />
                    <span id="consent-help">
                      Acepto que {titulo} use mi nombre, teléfono y email para contactarme
                      sobre esta solicitud. Los datos se conservan hasta 90 días si no
                      finalizo la consulta y se eliminan si retiro mi pedido.
                    </span>
                  </label>
                  </>)}
                </div>
              )}
            </div>

            {cart.items.length > 0 && !waEnviado && (
              <footer className="border-t p-4 space-y-2 bg-background/95 backdrop-blur">
                {step === "cart" ? (
                  <>
                    <div className="flex items-center justify-between text-base">
                      <span className="font-medium">Total</span>
                      <span className="text-lg font-bold" style={{ color: brandColor }}>
                        {formatPrecio(totalConCupon)}
                      </span>
                    </div>
                    {sinCanalDePedido && (
                      <p className="text-xs text-destructive inline-flex items-start gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        Este catálogo no está tomando pedidos online por el momento.
                      </p>
                    )}
                    <Button
                      onClick={() => setStep("checkout")}
                      className="w-full h-12 text-base font-semibold gap-1.5 shadow-md hover:shadow-lg transition-shadow"
                      style={{ backgroundColor: brandColor }}
                      disabled={!!uploadingItem || sinCanalDePedido}
                    >
                      Continuar
                    </Button>
                  </>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setStep("cart")}
                      disabled={submitting}
                      className="flex-1 h-12"
                    >
                      Atrás
                    </Button>
                    <Button
                      onClick={handleSubmit}
                      disabled={submitting || (!soloWhatsapp && (!nombre.trim() || !telefono.trim() || !consent))}
                      className="flex-1 h-12 gap-1.5 text-base font-semibold shadow-md hover:shadow-lg transition-shadow"
                      style={{ backgroundColor: brandColor }}
                    >
                      {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                      {soloWhatsapp ? "Enviar pedido por WhatsApp" : "Enviar solicitud"}
                    </Button>
                  </div>
                )}
              </footer>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
