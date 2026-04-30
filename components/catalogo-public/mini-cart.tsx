"use client"

import { Button } from "@/components/ui/button"
import { ShoppingCart, X } from "lucide-react"
import type { useCart } from "./use-cart"

interface Props {
  cart: ReturnType<typeof useCart>
  onOpen: () => void
  formatPrecio: (n: number) => string
  brandColor: string
}

export function MiniCart({ cart, onOpen, formatPrecio, brandColor }: Props) {
  if (cart.count === 0) return null

  return (
    <aside className="hidden lg:block sticky top-32 w-72 shrink-0">
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div
          className="px-4 py-3 text-white flex items-center gap-2 font-semibold"
          style={{ backgroundColor: brandColor }}
        >
          <ShoppingCart className="h-4 w-4" />
          Tu solicitud ({cart.count})
        </div>
        <div className="max-h-72 overflow-y-auto p-3 space-y-2">
          {cart.items.map((item) => (
            <div key={item.id} className="flex gap-2 items-start group">
              <div className="w-10 h-10 rounded bg-muted overflow-hidden shrink-0">
                {item.imagen_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imagen_url} alt={item.nombre} loading="lazy" className="w-full h-full object-cover" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium line-clamp-1">{item.nombre}</p>
                <p className="text-xs text-muted-foreground">
                  {item.cantidad} × {formatPrecio(item.precio)}
                </p>
              </div>
              <button
                onClick={() => cart.remove(item.id)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition"
                aria-label="Quitar"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        <div className="border-t p-3 space-y-2">
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>Total</span>
            <span style={{ color: brandColor }}>{formatPrecio(cart.total)}</span>
          </div>
          <Button onClick={onOpen} className="w-full" style={{ backgroundColor: brandColor }}>
            Ver y enviar
          </Button>
        </div>
      </div>
    </aside>
  )
}
