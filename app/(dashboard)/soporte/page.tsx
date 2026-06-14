import { TicketList } from "@/components/soporte/ticket-list"
import { WhatsAppSoporteCard } from "@/components/soporte/whatsapp-soporte-card"
import { PageShell } from "@/components/ui/page-shell"

export default function SoportePage() {
  return (
    <PageShell title="Soporte" description="Reportá errores, enviá sugerencias o consultá tus dudas">
      <WhatsAppSoporteCard />
      <TicketList />
    </PageShell>
  )
}
