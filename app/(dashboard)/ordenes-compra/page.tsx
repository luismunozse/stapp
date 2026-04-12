"use client"

import { OrdenesCompraList } from "@/components/ordenes-compra/ordenes-compra-list"

export default function OrdenesCompraPage() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Órdenes de Compra</h1>
        <p className="text-sm text-muted-foreground">
          Gestiona las órdenes de compra a proveedores y recepción de mercadería
        </p>
      </div>

      <OrdenesCompraList />
    </div>
  )
}
