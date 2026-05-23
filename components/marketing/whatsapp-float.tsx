"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { track } from "@/lib/analytics/track"

/**
 * Botón flotante de WhatsApp para páginas de marketing (landing, precios,
 * casos-de-uso, empresa, ayuda).
 *
 * - Usa `NEXT_PUBLIC_WHATSAPP_NUMBER` (formato internacional sin "+", ej. "5491169625733").
 * - Si la env var no está definida, renderiza null (no se muestra nada).
 * - Dispara evento `whatsapp_clicked` para GA4/Ads.
 *
 * No mostrar en `(dashboard)` ni en `(auth)`.
 */
export function WhatsAppFloat({
  message = "Hola, vengo de STApp",
  className,
}: {
  message?: string
  className?: string
}) {
  const [showTooltip, setShowTooltip] = useState(false)
  const number = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER

  if (!number) return null

  const href = `https://wa.me/${number}?text=${encodeURIComponent(message)}`

  const handleClick = () => {
    track("whatsapp_clicked", {
      location: typeof window !== "undefined" ? window.location.pathname : undefined,
    })
  }

  return (
    <div className={cn("fixed bottom-6 right-6 z-50", className)}>
      {/* Tooltip */}
      <span
        role="tooltip"
        className={cn(
          "absolute right-full mr-3 top-1/2 -translate-y-1/2",
          "px-3 py-1.5 rounded-lg whitespace-nowrap",
          "bg-gray-900 text-white text-sm font-medium shadow-lg",
          "pointer-events-none transition-opacity duration-200",
          showTooltip ? "opacity-100" : "opacity-0"
        )}
      >
        ¿Necesitás ayuda?
      </span>

      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        aria-label="Contactar por WhatsApp"
        className={cn(
          "flex items-center justify-center",
          "w-14 h-14 rounded-full",
          "bg-[#25D366] hover:bg-[#1ebe57] text-white",
          "shadow-lg hover:shadow-2xl transition-all duration-300 hover:scale-110",
          "focus:outline-none focus:ring-4 focus:ring-green-400 focus:ring-offset-2"
        )}
      >
        <svg
          viewBox="0 0 32 32"
          fill="currentColor"
          className="w-7 h-7"
          aria-hidden="true"
        >
          <path d="M16.004 0h-.008C7.174 0 0 7.176 0 16c0 3.5 1.128 6.744 3.046 9.378L1.054 31.29l6.118-1.958A15.924 15.924 0 0016.004 32C24.826 32 32 24.822 32 16S24.826 0 16.004 0zm9.31 22.606c-.39 1.1-1.932 2.012-3.182 2.278-.856.18-1.974.324-5.738-1.234-4.818-1.994-7.924-6.878-8.164-7.196-.232-.318-1.942-2.586-1.942-4.932s1.23-3.498 1.666-3.976c.436-.478.952-.598 1.27-.598.316 0 .632.002.908.016.292.016.684-.11 1.07.816.39.94 1.326 3.232 1.442 3.466.116.234.194.508.04.818-.156.316-.234.512-.468.79-.234.278-.492.62-.702.832-.234.234-.478.488-.206.958.274.468 1.216 2.006 2.61 3.25 1.792 1.6 3.304 2.096 3.772 2.33.468.234.742.196 1.016-.118.274-.316 1.178-1.374 1.492-1.846.316-.468.632-.39 1.062-.234.436.156 2.724 1.286 3.192 1.52.468.234.78.352.896.546.116.196.116 1.118-.274 2.218z" />
        </svg>
      </a>
    </div>
  )
}
