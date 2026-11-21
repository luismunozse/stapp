"use client"

import Link from "next/link"
import { VentasList } from "@/components/ventas/ventas-list"
import { VentasDashboard } from "@/components/ventas/ventas-dashboard"
import { Button } from "@/components/ui/button"
import { PageShell } from "@/components/ui/page-shell"
import { ShieldCheck } from "lucide-react"
import { PosAccessGate } from "@/components/pos/pos-access-gate"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { CobrosReparacionesList } from "@/components/ventas/cobros-reparaciones-list"

export default function VentasPage() {
  return (
    <PosAccessGate>
      <PageShell
        title="Ventas"
        className="container py-6 max-sm:py-0"
        actions={
          // Phones: this link lives in the list's "⋯" menu, so the header stays one row.
          <Button asChild variant="outline" size="sm" className="hidden gap-1.5 sm:inline-flex">
            <Link href="/garantias?origen=VENTA">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Garantías de ventas
            </Link>
          </Button>
        }
      >
        {/* Los cobros de órdenes no son ventas del POS (otra tabla, otra
            numeración): tienen su pestaña en vez de mezclarse con el listado. */}
        <Tabs defaultValue="ventas">
          <TabsList>
            <TabsTrigger value="ventas">Ventas</TabsTrigger>
            <TabsTrigger value="reparaciones">Reparaciones</TabsTrigger>
          </TabsList>
          <TabsContent value="ventas" className="space-y-4 sm:space-y-6">
            <VentasDashboard />

            <VentasList />
          </TabsContent>
          <TabsContent value="reparaciones">
            <CobrosReparacionesList />
          </TabsContent>
        </Tabs>
      </PageShell>
    </PosAccessGate>
  )
}
