"use client"

import { useState } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import { Sparkles, Lock, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

const AsistentePanel = dynamic(
  () => import("./asistente-panel").then((mod) => mod.AsistentePanel),
  {
    ssr: false,
    loading: () => (
      <div className="fixed bottom-36 right-4 md:bottom-20 md:right-6 z-[60] w-[90vw] max-w-md h-[500px] bg-card border shadow-2xl rounded-2xl flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    ),
  }
)

interface AsistenteWidgetProps {
  enabled: boolean
}

export function AsistenteWidget({ enabled }: AsistenteWidgetProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showLockedTip, setShowLockedTip] = useState(false)

  if (!enabled) {
    return (
      <div className="fixed bottom-36 right-4 md:bottom-20 md:right-6 z-40">
        {/* bottom-36/md:bottom-20: clears SyncStatusIndicator (bottom-24 mobile / lg:bottom-6, z-[55]) */}
        {showLockedTip && (
          <div className="absolute bottom-14 right-0 w-64 bg-card border shadow-lg rounded-xl p-3 text-sm">
            <p className="font-medium mb-1">Asistente de STApp</p>
            <p className="text-muted-foreground mb-2">
              Disponible en el plan Profesional: respondé tus dudas sobre cómo usar el sistema al instante.
            </p>
            <Link href="/configuracion/billing" className="text-primary font-medium hover:underline">
              Ver planes
            </Link>
          </div>
        )}
        <button
          onClick={() => setShowLockedTip((v) => !v)}
          aria-label="Asistente disponible en plan Profesional"
          className={cn(
            "w-12 h-12 rounded-full flex items-center justify-center",
            "bg-muted text-muted-foreground border shadow-md hover:bg-muted/80 transition-colors"
          )}
        >
          <Lock className="w-5 h-5" />
        </button>
      </div>
    )
  }

  return (
    <>
      {isOpen && <AsistentePanel onClose={() => setIsOpen(false)} />}
      {!isOpen && (
        <>
          {/* bottom-36/md:bottom-20: clears SyncStatusIndicator (bottom-24 mobile / lg:bottom-6, z-[55]) */}
          <button
            onClick={() => setIsOpen(true)}
            aria-label="Abrir asistente de STApp"
            className={cn(
              "fixed bottom-36 right-4 md:bottom-20 md:right-6 z-40",
              "w-12 h-12 rounded-full flex items-center justify-center",
              "bg-primary text-primary-foreground shadow-lg hover:opacity-90 transition-opacity"
            )}
          >
            <Sparkles className="w-5 h-5" />
          </button>
        </>
      )}
    </>
  )
}
