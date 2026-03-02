"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle, X, Loader2, Trash2 } from "lucide-react"

export function SampleDataBanner() {
  const [visible, setVisible] = useState(true)
  const [cleaning, setCleaning] = useState(false)

  if (!visible) return null

  const handleClean = async () => {
    setCleaning(true)
    try {
      const res = await fetch("/api/onboarding/sample-data", { method: "DELETE" })
      if (res.ok) {
        setVisible(false)
        window.location.reload()
      }
    } catch (err) {
      console.error("Error cleaning sample data:", err)
    } finally {
      setCleaning(false)
    }
  }

  return (
    <div className="bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800 px-4 py-2">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Estás viendo <strong>datos de ejemplo</strong>. Eliminalos cuando estés listo para usar datos reales.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleClean}
            disabled={cleaning}
            className="text-amber-800 border-amber-300 hover:bg-amber-100 dark:text-amber-200 dark:border-amber-700 dark:hover:bg-amber-900"
          >
            {cleaning ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="mr-1 h-3 w-3" />
            )}
            Limpiar datos de ejemplo
          </Button>
          <button
            onClick={() => setVisible(false)}
            className="p-1 hover:bg-amber-100 dark:hover:bg-amber-900 rounded"
          >
            <X className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </button>
        </div>
      </div>
    </div>
  )
}
