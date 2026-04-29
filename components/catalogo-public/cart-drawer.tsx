"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useRouter } from "next/navigation"
import { X, Plus, Minus, Trash2, ShoppingCart, Loader2, CheckCircle2 } from "lucide-react"
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

export function CartDrawer({ open, onClose, cart, slug, titulo, formatPrecio, brandColor }: Props) {
  const router = useRouter()
  const [step, setStep] = useState<"cart" | "checkout">("cart")
  const [submitting, setSubmitting] = useState(false)

  const [nombre, setNombre] = useState("")
  const [telefono, setTelefono] = useState("")
  const [email, setEmail] = useState("")
  const [notas, setNotas] = useState("")

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
          items: cart.items.map((i) => ({ itemId: i.id, cantidad: i.cantidad })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error al enviar")
      cart.clear()
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
                    {cart.items.map((item) => (
                      <div key={item.id} className="flex gap-3 border rounded-lg p-2">
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
                    ))}
                  </div>
                )
              ) : (
                <div className="p-4 space-y-3">
                  <div className="rounded-lg bg-muted/40 p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Items</span>
                      <span>{cart.count}</span>
                    </div>
                    <div className="flex items-center justify-between font-semibold">
                      <span>Total estimado</span>
                      <span style={{ color: brandColor }}>{formatPrecio(cart.total)}</span>
                    </div>
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
                      <span style={{ color: brandColor }}>{formatPrecio(cart.total)}</span>
                    </div>
                    <Button
                      onClick={() => setStep("checkout")}
                      className="w-full"
                      size="lg"
                      style={{ backgroundColor: brandColor }}
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
