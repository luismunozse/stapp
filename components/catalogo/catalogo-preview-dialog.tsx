"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Smartphone, Monitor, RotateCw, ExternalLink } from "lucide-react"

interface CatalogoPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  slug: string
  activo: boolean
}

export function CatalogoPreviewDialog({ open, onOpenChange, slug, activo }: CatalogoPreviewDialogProps) {
  const [device, setDevice] = useState<"mobile" | "desktop">("desktop")
  const [reloadKey, setReloadKey] = useState(0)
  const url = `/catalogo/${slug}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-8">
            <DialogTitle>Vista previa</DialogTitle>
            {activo && (
              <div className="flex items-center gap-1">
                <div className="inline-flex rounded-md border bg-background p-0.5">
                  <button
                    onClick={() => setDevice("mobile")}
                    aria-label="Vista móvil"
                    className={`h-7 w-7 inline-flex items-center justify-center rounded-sm ${
                      device === "mobile" ? "bg-muted text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <Smartphone className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setDevice("desktop")}
                    aria-label="Vista desktop"
                    className={`h-7 w-7 inline-flex items-center justify-center rounded-sm ${
                      device === "desktop" ? "bg-muted text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <Monitor className="h-4 w-4" />
                  </button>
                </div>
                <Button variant="ghost" size="icon" aria-label="Refrescar" onClick={() => setReloadKey((k) => k + 1)}>
                  <RotateCw className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Abrir en pestaña" asChild>
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </div>
            )}
          </div>
        </DialogHeader>

        {activo ? (
          <div className="flex-1 min-h-0 flex justify-center bg-muted/30 rounded-md overflow-hidden">
            <iframe
              key={reloadKey}
              src={url}
              title="Vista previa del catálogo"
              className={`h-full bg-background ${device === "mobile" ? "w-[375px]" : "w-full"}`}
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center text-sm text-muted-foreground px-6">
            El catálogo está desactivado. Activalo en la pestaña Compartir para previsualizarlo.
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
