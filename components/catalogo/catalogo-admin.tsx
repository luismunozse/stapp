"use client"

import { useState, useEffect } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Package, FolderTree, Share2, BookMarked, Ticket, ShoppingCart, Eye } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageShell } from "@/components/ui/page-shell"
import { CatalogoPreviewDialog } from "./catalogo-preview-dialog"
import { CatalogoItemsTab } from "./catalogo-items-tab"
import { CatalogoCategoriasTab } from "./catalogo-categorias-tab"
import { CatalogoCompartirTab } from "./catalogo-compartir-tab"
import { CatalogoCuponesTab } from "./catalogo-cupones-tab"
import { CatalogoCarritosAbandonadosTab } from "./catalogo-carritos-abandonados-tab"

export function CatalogoAdmin() {
  const [tab, setTab] = useState("items")
  const [config, setConfig] = useState<{ slug: string; activo: boolean } | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    fetch("/api/catalogo/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.config?.slug) setConfig({ slug: d.config.slug, activo: !!d.config.activo })
      })
      .catch(() => {})
  }, [])

  return (
    <PageShell
      title="Catálogo público"
      description="Compartí tu lista de productos y servicios. Los clientes pueden navegar y solicitar cotización."
      icon={BookMarked}
      actions={
        <Button
          variant="outline"
          className="gap-1.5 shrink-0"
          disabled={!config}
          onClick={() => setPreviewOpen(true)}
          aria-label="Vista previa"
        >
          <Eye className="h-4 w-4" />
          <span className="hidden sm:inline">Vista previa</span>
        </Button>
      }
    >

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-5 max-w-3xl">
          <TabsTrigger value="items" className="gap-2">
            <Package className="h-4 w-4" />
            <span className="hidden sm:inline">Items</span>
          </TabsTrigger>
          <TabsTrigger value="categorias" className="gap-2">
            <FolderTree className="h-4 w-4" />
            <span className="hidden sm:inline">Categorías</span>
          </TabsTrigger>
          <TabsTrigger value="cupones" className="gap-2">
            <Ticket className="h-4 w-4" />
            <span className="hidden sm:inline">Cupones</span>
          </TabsTrigger>
          <TabsTrigger value="abandonados" className="gap-2">
            <ShoppingCart className="h-4 w-4" />
            <span className="hidden sm:inline">Abandonados</span>
          </TabsTrigger>
          <TabsTrigger value="compartir" className="gap-2">
            <Share2 className="h-4 w-4" />
            <span className="hidden sm:inline">Compartir</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="mt-6">
          <CatalogoItemsTab />
        </TabsContent>
        <TabsContent value="categorias" className="mt-6">
          <CatalogoCategoriasTab />
        </TabsContent>
        <TabsContent value="cupones" className="mt-6">
          <CatalogoCuponesTab />
        </TabsContent>
        <TabsContent value="abandonados" className="mt-6">
          <CatalogoCarritosAbandonadosTab />
        </TabsContent>
        <TabsContent value="compartir" className="mt-6">
          <CatalogoCompartirTab />
        </TabsContent>
      </Tabs>

      {config && (
        <CatalogoPreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          slug={config.slug}
          activo={config.activo}
        />
      )}
    </PageShell>
  )
}
