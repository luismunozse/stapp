"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ComisionesView } from "@/components/comisiones/comisiones-view"
import { ComisionesVendedoresView } from "@/components/comisiones/comisiones-vendedores-view"
import { PageShell } from "@/components/ui/page-shell"

export default function ComisionesPage() {
  return (
    <PageShell title="Comisiones" description="Liquidación de comisiones de técnicos, recepción y vendedores.">
      <Tabs defaultValue="tecnicos" className="space-y-4">
        <TabsList>
          <TabsTrigger value="tecnicos">Técnicos</TabsTrigger>
          <TabsTrigger value="recepcion">Recepción</TabsTrigger>
          <TabsTrigger value="vendedores">Vendedores</TabsTrigger>
        </TabsList>

        <TabsContent value="tecnicos">
          <ComisionesView />
        </TabsContent>

        <TabsContent value="recepcion">
          <ComisionesView rol="RECEPCION" />
        </TabsContent>

        <TabsContent value="vendedores">
          <ComisionesVendedoresView />
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}
