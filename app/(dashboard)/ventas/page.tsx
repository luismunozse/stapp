"use client"

import Link from "next/link"
import { VentasList } from "@/components/ventas/ventas-list"
import { VentasDashboard } from "@/components/ventas/ventas-dashboard"
import { Button } from "@/components/ui/button"
import { ShieldCheck } from "lucide-react"
import { PosAccessGate } from "@/components/pos/pos-access-gate"

export default function VentasPage() {
  return (
    <PosAccessGate>
      <div className="container py-6 space-y-6">
        <VentasDashboard />

        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/garantias?origen=VENTA">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Garantías de ventas
            </Link>
          </Button>
        </div>

        <VentasList />
      </div>
    </PosAccessGate>
  )
}
