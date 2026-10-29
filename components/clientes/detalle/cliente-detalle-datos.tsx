"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Phone, Mail, MapPin, IdCard, Building2 } from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import type { Cliente } from "@/types"
import { useCurrency } from "@/contexts/currency-context"
import { getTaxIdLabel, getPersonalIdLabel } from "@/lib/countries"
import { telHref } from "@/lib/tel-href"

function Row({ icon: Icon, label, value, href, external }: {
  icon: typeof Phone; label: string; value: string; href?: string; external?: boolean
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
      <span className="text-muted-foreground shrink-0">{label}:</span>
      {href ? (
        <a
          href={href}
          className="min-w-0 break-words hover:text-primary hover:underline underline-offset-2"
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {value}
        </a>
      ) : (
        <span className="min-w-0 break-words">{value}</span>
      )}
    </div>
  )
}

export function ClienteDetalleDatos({ cliente }: { cliente: Cliente }) {
  const { pais } = useCurrency()
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Datos &amp; contacto</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {cliente.telefono && <Row icon={Phone} label="Teléfono" value={cliente.telefono} href={telHref(cliente.telefono) ? `tel:${telHref(cliente.telefono)}` : undefined} />}
        {cliente.email && <Row icon={Mail} label="Email" value={cliente.email} href={`mailto:${cliente.email}`} />}
        {cliente.direccion && <Row
          icon={MapPin}
          label="Dirección"
          value={cliente.direccion}
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cliente.direccion)}`}
          external
        />}
        {cliente.dni && <Row icon={IdCard} label={getPersonalIdLabel(pais)} value={cliente.dni} />}
        {cliente.razonSocial && <Row icon={Building2} label="Razón social" value={cliente.razonSocial} />}
        {cliente.cuit && <Row icon={IdCard} label={getTaxIdLabel(pais)} value={cliente.cuit} />}
        <div className="flex items-start gap-2 text-sm">
          <WhatsAppIcon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <span className="text-muted-foreground">WhatsApp:</span>
          <span className="min-w-0 break-words">{cliente.aceptaWhatsapp === false ? "No recibe" : "Recibe"}</span>
        </div>
      </CardContent>
    </Card>
  )
}
