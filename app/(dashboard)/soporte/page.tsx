import { TicketList } from "@/components/soporte/ticket-list"
import { WhatsAppSoporteCard } from "@/components/soporte/whatsapp-soporte-card"

export default function SoportePage() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Soporte</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Reportá errores, enviá sugerencias o consultá tus dudas
        </p>
      </div>
      <WhatsAppSoporteCard />
      <TicketList />
    </div>
  )
}
