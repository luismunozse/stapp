"use client"

import { useParams } from "next/navigation"
import { LeadDetailContent } from "./_components/lead-detail-content"

export default function SuperadminLeadDetailPage() {
  const params = useParams()
  const id = params.id as string

  return <LeadDetailContent leadId={id} />
}
