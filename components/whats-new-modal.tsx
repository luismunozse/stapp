"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Sparkles, Zap, Wrench, Bug } from "lucide-react"
import { APP_VERSION, getNewChanges, type ChangeType } from "@/lib/changelog"

const changeTypeConfig: Record<
  ChangeType,
  { icon: typeof Sparkles; label: string; color: string }
> = {
  feature: {
    icon: Sparkles,
    label: "Nuevo",
    color: "text-blue-600 dark:text-blue-400",
  },
  improvement: {
    icon: Zap,
    label: "Mejora",
    color: "text-amber-600 dark:text-amber-400",
  },
  fix: {
    icon: Wrench,
    label: "Corrección",
    color: "text-green-600 dark:text-green-400",
  },
}

interface WhatsNewModalProps {
  lastSeenVersion: string | null
}

export function WhatsNewModal({ lastSeenVersion }: WhatsNewModalProps) {
  const [open, setOpen] = useState(false)

  const newChanges = getNewChanges(lastSeenVersion)

  useEffect(() => {
    if (newChanges.length === 0) return

    // Pequeño delay para mejor UX (igual que PolicyChangeModal)
    const timer = setTimeout(() => setOpen(true), 500)
    return () => clearTimeout(timer)
  }, [newChanges.length])

  const handleClose = async () => {
    setOpen(false)
    try {
      await fetch("/api/user/seen-version", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    } catch {
      // Silenciar error — se reintentará la próxima vez
    }
  }

  if (newChanges.length === 0) return null

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-md max-h-[85dvh] flex flex-col pb-[env(safe-area-inset-bottom,1rem)]">
        <DialogHeader className="text-center sm:text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-500">
            <Sparkles className="h-8 w-8 text-white" />
          </div>
          <DialogTitle className="text-xl">Novedades en STApp</DialogTitle>
          <DialogDescription className="text-base">
            Versión {APP_VERSION} — Mirá lo nuevo
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4 overflow-y-auto flex-1">
          {newChanges.map((version) => (
            <div key={version.version} className="space-y-3">
              {newChanges.length > 1 && (
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">
                    v{version.version}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {version.date}
                  </span>
                </div>
              )}
              <p className="text-sm font-medium text-foreground">
                {version.title}
              </p>
              <ul className="space-y-2">
                {version.changes.map((change, i) => {
                  const config = changeTypeConfig[change.type]
                  const Icon = config.icon
                  return (
                    <li key={change.description} className="flex items-start gap-2.5 text-sm">
                      <Icon
                        className={`h-4 w-4 mt-0.5 shrink-0 ${config.color}`}
                      />
                      <span className="text-muted-foreground">
                        {change.description}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>

        <DialogFooter className="sm:justify-center gap-2">
          <Button onClick={handleClose} className="w-full sm:w-auto">
            ¡Genial, entendido!
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
