"use client"

import { useState } from "react"
import { Check } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { MAX_BOTTOM_NAV, type NavItem } from "@/lib/navegacion"

interface BottomNavEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Everything the user can navigate to (already filtered by role/module). */
  items: NavItem[]
  /** What the bar shows now, in order. */
  actuales: NavItem[]
  onSave: (hrefs: string[] | null) => void
}

/**
 * Lets each person pick the shortcuts of the phone bottom bar (a technician
 * wants Órdenes + Agenda, a seller POS + Caja). Order = tap order.
 */
export function BottomNavEditor({ open, onOpenChange, items, actuales, onSave }: BottomNavEditorProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Keyed by open so each opening starts from what the bar shows now */}
        {open && <Editor items={items} actuales={actuales} onSave={onSave} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function Editor({
  items,
  actuales,
  onSave,
  onClose,
}: Omit<BottomNavEditorProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const [elegidos, setElegidos] = useState<string[]>(() => actuales.map((i) => i.href))
  const lleno = elegidos.length >= MAX_BOTTOM_NAV

  const toggle = (href: string) => {
    setElegidos((prev) =>
      prev.includes(href) ? prev.filter((h) => h !== href) : prev.length >= MAX_BOTTOM_NAV ? prev : [...prev, href]
    )
  }

  // Unique by href (the nav lists some destinations under two labels)
  const opciones = items.filter((item, i, arr) => arr.findIndex((o) => o.href === item.href) === i)

  return (
    <>
      <DialogHeader>
        <DialogTitle>Barra de accesos</DialogTitle>
        <DialogDescription>
          Elegí hasta {MAX_BOTTOM_NAV} accesos para la barra de abajo, en el orden en que los tocás. El resto queda en
          &quot;Más&quot;. Se guarda en este dispositivo.
        </DialogDescription>
      </DialogHeader>

      <ul className="-mx-1 max-h-[50dvh] space-y-1 overflow-y-auto px-1" aria-label="Accesos disponibles">
        {opciones.map((item) => {
          const Icon = item.icon
          const posicion = elegidos.indexOf(item.href)
          const activo = posicion >= 0
          const bloqueado = !activo && lleno
          return (
            <li key={item.href}>
              <button
                type="button"
                role="checkbox"
                aria-checked={activo}
                disabled={bloqueado}
                onClick={() => toggle(item.href)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  activo ? "border-primary bg-primary/5 font-medium" : "border-border hover:bg-accent",
                  bloqueado && "opacity-50"
                )}
              >
                <Icon className={cn("h-5 w-5 shrink-0", activo ? "text-primary" : "text-muted-foreground")} />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    activo ? "bg-primary text-primary-foreground" : "border border-border"
                  )}
                  aria-hidden
                >
                  {activo ? posicion + 1 : <Check className="h-3.5 w-3.5 opacity-0" />}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button
          variant="ghost"
          onClick={() => {
            onSave(null)
            onClose()
          }}
        >
          Restablecer
        </Button>
        <Button
          disabled={elegidos.length === 0}
          onClick={() => {
            onSave(elegidos)
            onClose()
          }}
        >
          Guardar
        </Button>
      </DialogFooter>
    </>
  )
}
