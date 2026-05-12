"use client"

import { useRef, useState } from "react"
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

interface Props {
  open: boolean
  onClose: () => void
  cart: ReturnType<typeof useCart>
  slug: string
  titulo: string
  formatPrecio: (n: number) => string
  brandColor: string
}

const MAX_ADJUNTOS_POR_ITEM = 3

type ItemExtras = { comentario: string; adjuntos: string[] }

export function CartDrawer({ open, onClose, cart, slug, titulo, formatPrecio, brandColor }: Props) {
  const router = useRouter()
  const [step, setStep] = useState<"cart" | "checkout">("cart")
  const [submitting, setSubmitting] = useState(false)

  const [nombre, setNombre] = useState("")
  const [telefono, setTelefono] = useState("")
  const [email, setEmail] = useState("")
  const [notas, setNotas] = useState("")
  const [extras, setExtras] = useState<Record<string, ItemExtras>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [uploadingItem, setUploadingItem] = useState<string | null>(null)
  const fileInputsRef = useRef<Record<string, HTMLInputElement | null>>({})

  const [cuponInput, setCuponInput] = useState("")
  const [cuponAplicado, setCuponAplicado] = useState<{ codigo: string; descuento: number } | null>(null)
  const [cuponError, setCuponError] = useState<string | null>(null)
  const [validatingCupon, setValidatingCupon] = useState(false)

  const totalConCupon = Math.max(0, cart.total - (cuponAplicado?.descuento ?? 0))

  const aplicarCupon = async () => {
    const codigo = cuponInput.trim().toUpperCase()
    if (!codigo) return
    setValidatingCupon(true)
    setCuponError(null)
    try {
      const res = await fetch(`/api/public/catalogo/${slug}/cupon/validar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo, subtotal: cart.total }),
      })
      const data = await res.json()
      if (!data.ok) {
        setCuponError(data.error || "Cupón inválido")
        setCuponAplicado(null)
        return
      }
      setCuponAplicado({
        codigo: data.codigo,
        descuento: Number(data.descuento_aplicado) || 0,
      })
      toast.success(`Cupón ${data.codigo} aplicado`)
    } catch {
      setCuponError("Error al validar cupón")
    } finally {
      setValidatingCupon(false)
    }
  }

  const quitarCupon = () => {
    setCuponAplicado(null)
    setCuponInput("")
    setCuponError(null)
  }

  const getExtras = (id: string): ItemExtras => extras[id] ?? { comentario: "", adjuntos: [] }

  const setExtra = (id: string, patch: Partial<ItemExtras>) => {
    setExtras((prev) => {
      const curr = prev[id] ?? { comentario: "", adjuntos: [] }
      return { ...prev, [id]: { ...curr, ...patch } }
    })
  }

  const handleUpload = async (itemId: string, file: File) => {
    if (file.size > 4 * 1024 * 1024) {
      toast.error("La foto supera 4MB")
      return
    }
    setUploadingItem(itemId)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch(`/api/public/catalogo/${slug}/upload`, { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error subiendo foto")
      const current = getExtras(itemId).adjuntos
      setExtra(itemId, { adjuntos: [...current, data.url].slice(0, MAX_ADJUNTOS_POR_ITEM) })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error subiendo foto")
    } finally {
      setUploadingItem(null)
    }
  }

  const removeAdjunto = (itemId: string, url: string) => {
    const current = getExtras(itemId).adjuntos
    setExtra(itemId, { adjuntos: current.filter((u) => u !== url) })
  }

  const handleSubmit = async () => {
    if (!nombre.trim() || !telefono.trim()) {
      toast.error("Nombre y teléfono son obligatorios")
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
          items: cart.items.map((i) => {
            const ex = extras[i.id]
            return {
              itemId: i.id,
              cantidad: i.cantidad,
              comentario: ex?.comentario?.trim() || undefined,
              adjuntos: ex?.adjuntos?.length ? ex.adjuntos : undefined,
            }
          }),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error al enviar")
      cart.clear()
      setExtras({})
      toast.success("¡Solicitud enviada!")
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
            className="fixed right-0 top-0 bottom-0 z-50 w-full sm:max-w-md bg-background shadow-2xl flex flex-col"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            <header className="flex items-center justify-between p-4 border-b">
              <h2 className="font-semibold flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                {step === "cart" ? "Tu solicitud" : "Tus datos"}
              </h2>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </header>

            <div className="flex-1 overflow-y-auto">
              {step === "cart" ? (
                cart.items.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-6">
                    <ShoppingCart className="h-12 w-12 mb-3 opacity-50" />
                    <p>Tu carrito está vacío</p>
                  </div>
                ) : (
                  <div className="p-4 space-y-3">
                    {cart.items.map((item) => {
                      const ex = getExtras(item.id)
                      const hasExtras = ex.comentario.length > 0 || ex.adjuntos.length > 0
                      const isExpanded = expanded[item.id] || hasExtras
                      const isUploading = uploadingItem === item.id
                      return (
                        <div key={item.id} className="border rounded-lg p-2 space-y-2">
                          <div className="flex gap-3">
                            <div className="w-16 h-16 rounded-md bg-muted overflow-hidden shrink-0">
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
                              <h3 className="text-sm font-medium line-clamp-2">{item.nombre}</h3>
                              <div className="text-sm font-semibold mt-0.5" style={{ color: brandColor }}>
                                {formatPrecio(item.precio * item.cantidad)}
                              </div>
                              <div className="flex items-center gap-1 mt-1.5">
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => cart.setCantidad(item.id, item.cantidad - 1)}
                                >
                                  <Minus className="h-3 w-3" />
                                </Button>
                                <span className="w-8 text-center text-sm">{item.cantidad}</span>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => cart.setCantidad(item.id, item.cantidad + 1)}
                                  disabled={item.stock_disponible != null && item.cantidad >= item.stock_disponible}
                                >
                                  <Plus className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 ml-auto"
                                  onClick={() => cart.remove(item.id)}
                                >
                                  <Trash2 className="h-3 w-3 text-destructive" />
                                </Button>
                              </div>
                            </div>
                          </div>

                          {!isExpanded ? (
                            <button
                              onClick={() => setExpanded((prev) => ({ ...prev, [item.id]: true }))}
                              className="w-full text-left text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
                            >
                              <MessageSquare className="h-3 w-3" />
                              Agregar comentario o foto
                            </button>
                          ) : (
                            <div className="space-y-2 pt-1 border-t">
                              <Textarea
                                value={ex.comentario}
                                onChange={(e) => setExtra(item.id, { comentario: e.target.value })}
                                rows={2}
                                maxLength={500}
                                placeholder="Comentario (ej: pantalla rota lado superior)"
                                className="text-xs resize-none"
                              />
                              <div className="flex flex-wrap gap-1.5">
                                {ex.adjuntos.map((url) => (
                                  <div key={url} className="relative h-14 w-14 rounded-md overflow-hidden border group/img">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={url} alt="" className="w-full h-full object-cover" />
                                    <button
                                      type="button"
                                      onClick={() => removeAdjunto(item.id, url)}
                                      className="absolute inset-0 bg-black/50 opacity-0 group-hover/img:opacity-100 flex items-center justify-center transition-opacity"
                                      aria-label="Quitar foto"
                                    >
                                      <X className="h-4 w-4 text-white" />
                                    </button>
                                  </div>
                                ))}
                                {ex.adjuntos.length < MAX_ADJUNTOS_POR_ITEM && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => fileInputsRef.current[item.id]?.click()}
                                      disabled={isUploading}
                                      className="h-14 w-14 rounded-md border-2 border-dashed flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground transition-colors disabled:opacity-50"
                                      aria-label="Agregar foto"
                                    >
                                      {isUploading ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Camera className="h-4 w-4" />
                                      )}
                                    </button>
                                    <input
                                      ref={(el) => {
                                        fileInputsRef.current[item.id] = el
                                      }}
                                      type="file"
                                      accept="image/jpeg,image/png,image/webp"
                                      capture="environment"
                                      className="hidden"
                                      onChange={(e) => {
                                        const f = e.target.files?.[0]
                                        if (f) handleUpload(item.id, f)
                                        e.target.value = ""
                                      }}
                                    />
                                  </>
                                )}
                              </div>
                              <p className="text-[10px] text-muted-foreground">
                                Hasta {MAX_ADJUNTOS_POR_ITEM} fotos · JPG/PNG/WEBP · máx 4MB
                              </p>
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
                            setCuponError(null)
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

                  <div>
                    <Label htmlFor="nombre">Nombre completo *</Label>
                    <Input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} />
                  </div>
                  <div>
                    <Label htmlFor="telefono">Teléfono / WhatsApp *</Label>
                    <Input id="telefono" type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} maxLength={40} />
                  </div>
                  <div>
                    <Label htmlFor="email">Email (opcional)</Label>
                    <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="notas">Notas (opcional)</Label>
                    <Textarea
                      id="notas"
                      value={notas}
                      onChange={(e) => setNotas(e.target.value)}
                      rows={3}
                      maxLength={1000}
                      placeholder="Algún detalle que quieras compartir..."
                    />
                  </div>

                  <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 p-3 text-xs text-blue-900 dark:text-blue-200 flex gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>Esta solicitud genera un presupuesto en {titulo}. Te van a contactar para confirmar.</span>
                  </div>
                </div>
              )}
            </div>

            {cart.items.length > 0 && (
              <footer className="border-t p-4 space-y-2">
                {step === "cart" ? (
                  <>
                    <div className="flex items-center justify-between text-base font-semibold">
                      <span>Total</span>
                      <span style={{ color: brandColor }}>{formatPrecio(totalConCupon)}</span>
                    </div>
                    <Button
                      onClick={() => setStep("checkout")}
                      className="w-full"
                      size="lg"
                      style={{ backgroundColor: brandColor }}
                      disabled={!!uploadingItem}
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
                      className="flex-1"
                    >
                      Atrás
                    </Button>
                    <Button
                      onClick={handleSubmit}
                      disabled={submitting}
                      className="flex-1 gap-1.5"
                      style={{ backgroundColor: brandColor }}
                    >
                      {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                      Enviar
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
