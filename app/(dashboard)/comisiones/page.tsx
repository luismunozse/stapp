"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ComisionesView } from "@/components/comisiones/comisiones-view"
import { ComisionesVendedoresView } from "@/components/comisiones/comisiones-vendedores-view"

export default function ComisionesPage() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Comisiones</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Liquidación de comisiones de técnicos y vendedores.
        </p>
      </div>

      <Tabs defaultValue="tecnicos" className="space-y-4">
        <TabsList>
          <TabsTrigger value="tecnicos">Técnicos</TabsTrigger>
          <TabsTrigger value="vendedores">Vendedores</TabsTrigger>
        </TabsList>

        <TabsContent value="tecnicos">
          <ComisionesView />
        </TabsContent>

        <TabsContent value="vendedores">
          <ComisionesVendedoresView />
        </TabsContent>
      </Tabs>
    </div>
  )
}
