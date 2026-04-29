"use client"

import { useState } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Package, FolderTree, Share2, BookMarked } from "lucide-react"
import { CatalogoItemsTab } from "./catalogo-items-tab"
import { CatalogoCategoriasTab } from "./catalogo-categorias-tab"
import { CatalogoCompartirTab } from "./catalogo-compartir-tab"

export function CatalogoAdmin() {
  const [tab, setTab] = useState("items")

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2">
          <BookMarked className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Catálogo público</h1>
          <p className="text-sm text-muted-foreground">
            Compartí tu lista de productos y servicios. Los clientes pueden navegar y solicitar cotización.
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-3 max-w-xl">
          <TabsTrigger value="items" className="gap-2">
            <Package className="h-4 w-4" />
            <span className="hidden sm:inline">Items</span>
          </TabsTrigger>
          <TabsTrigger value="categorias" className="gap-2">
            <FolderTree className="h-4 w-4" />
            <span className="hidden sm:inline">Categorías</span>
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
        <TabsContent value="compartir" className="mt-6">
          <CatalogoCompartirTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
