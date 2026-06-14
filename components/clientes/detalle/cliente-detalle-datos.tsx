"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Phone, Mail, MapPin, IdCard, Building2, MessageCircle } from "lucide-react"
import type { Cliente } from "@/types"

function Row({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="truncate">{value}</span>
    </div>
  )
}

export function ClienteDetalleDatos({ cliente }: { cliente: Cliente }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Datos &amp; contacto</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {cliente.telefono && <Row icon={Phone} label="Teléfono" value={cliente.telefono} />}
        {cliente.email && <Row icon={Mail} label="Email" value={cliente.email} />}
        {cliente.direccion && <Row icon={MapPin} label="Dirección" value={cliente.direccion} />}
        {cliente.dni && <Row icon={IdCard} label="DNI" value={cliente.dni} />}
        {cliente.razonSocial && <Row icon={Building2} label="Razón social" value={cliente.razonSocial} />}
        {cliente.cuit && <Row icon={IdCard} label="CUIT" value={cliente.cuit} />}
        <Row icon={MessageCircle} label="WhatsApp" value={cliente.aceptaWhatsapp === false ? "No recibe" : "Recibe"} />
      </CardContent>
    </Card>
  )
}
