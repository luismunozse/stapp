"use client"

import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

interface LastUpdatedProps {
  formattedLastUpdated: string
  onRefresh?: () => void
  loading?: boolean
}

export function LastUpdated({ formattedLastUpdated, onRefresh, loading }: LastUpdatedProps) {
  if (!formattedLastUpdated) return null

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>
        {"\u00DAltima actualizaci\u00F3n: "}
        {formattedLastUpdated}
      </span>
      {onRefresh && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onRefresh}
          disabled={loading}
          title="Actualizar"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      )}
    </div>
  )
}
