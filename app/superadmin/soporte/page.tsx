"use client"

import { TicketsListSuperadmin } from "@/components/superadmin/soporte/tickets-list-superadmin"

export default function SuperadminSoportePage() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Soporte</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Gestiona los tickets de soporte de todas las organizaciones
        </p>
      </div>
      <TicketsListSuperadmin />
    </div>
  )
}
