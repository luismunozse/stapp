"use client"

import { useParams } from "next/navigation"
import { TicketDetailSuperadmin } from "@/components/superadmin/soporte/ticket-detail-superadmin"

export default function SuperadminTicketDetailPage() {
  const params = useParams()
  const id = params.id as string

  return (
    <div className="space-y-4 sm:space-y-6">
      <TicketDetailSuperadmin ticketId={id} />
    </div>
  )
}
