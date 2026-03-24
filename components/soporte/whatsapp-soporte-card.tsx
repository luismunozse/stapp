"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

const WHATSAPP_NUMBER = "5491169625733"
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
  "Hola! Necesito ayuda con STApp."
)}`

export function WhatsAppSoporteCard() {
  return (
    <Card className="border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20">
      <CardContent className="flex items-center gap-4 p-4">
        <div className="h-10 w-10 rounded-full bg-[#25D366] flex items-center justify-center shrink-0">
          <svg
            viewBox="0 0 32 32"
            fill="currentColor"
            className="w-5 h-5 text-white"
            aria-hidden="true"
          >
            <path d="M16.004 0h-.008C7.174 0 0 7.176 0 16c0 3.5 1.128 6.744 3.046 9.378L1.054 31.29l6.118-1.958A15.924 15.924 0 0016.004 32C24.826 32 32 24.822 32 16S24.826 0 16.004 0zm9.31 22.606c-.39 1.1-1.932 2.012-3.182 2.278-.856.18-1.974.324-5.738-1.234-4.818-1.994-7.924-6.878-8.164-7.196-.232-.318-1.942-2.586-1.942-4.932s1.23-3.498 1.666-3.976c.436-.478.952-.598 1.27-.598.316 0 .632.002.908.016.292.016.684-.11 1.07.816.39.94 1.326 3.232 1.442 3.466.116.234.194.508.04.818-.156.316-.234.512-.468.79-.234.278-.492.62-.702.832-.234.234-.478.488-.206.958.274.468 1.216 2.006 2.61 3.25 1.792 1.6 3.304 2.096 3.772 2.33.468.234.742.196 1.016-.118.274-.316 1.178-1.374 1.492-1.846.316-.468.632-.39 1.062-.234.436.156 2.724 1.286 3.192 1.52.468.234.78.352.896.546.116.196.116 1.118-.274 2.218z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-green-800 dark:text-green-300">
            ¿Necesitás ayuda rápida?
          </p>
          <p className="text-xs text-green-600 dark:text-green-500">
            Escribinos por WhatsApp y te respondemos al instante
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 text-green-700 border-green-300 hover:bg-green-100 hover:text-green-800 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950"
          asChild
        >
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
            Chatear
          </a>
        </Button>
      </CardContent>
    </Card>
  )
}
