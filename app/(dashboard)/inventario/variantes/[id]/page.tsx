"use client"

import { use, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Layers } from "lucide-react"
import { VariantesDialog } from "@/components/inventario/variantes-dialog"

// Full-page editor para items con muchas variantes.
// Reutiliza el dialog en modo siempre abierto.

interface Props {
  params: Promise<{ id: string }>
}

export default function VariantesItemPage({ params }: Props) {
  const { id } = use(params)
  const [refreshKey, setRefreshKey] = useState(0)
  const [nombre, setNombre] = useState<string>("")

  // Fetch item nombre una vez
  if (!nombre) {
    fetch(`/api/inventario/${id}/variantes`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.parent?.nombre) setNombre(j.parent.nombre)
      })
      .catch(() => {})
  }

  return (
    <div className="container max-w-6xl mx-auto py-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/inventario">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Inventario
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Layers className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Variantes</h1>
        {nombre && (
          <span className="text-sm text-muted-foreground truncate">— {nombre}</span>
        )}
      </div>

      <VariantesDialog
        open
        onOpenChange={() => {}}
        inventarioId={id}
        inventarioNombre={nombre || "Cargando..."}
        onChange={() => setRefreshKey((k) => k + 1)}
        key={refreshKey}
      />
    </div>
  )
}
