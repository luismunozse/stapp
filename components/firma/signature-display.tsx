"use client"

import { Card, CardContent } from "@/components/ui/card"
import { PenTool } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

interface SignatureDisplayProps {
  signature: string
  mime: string
  label?: string
  date?: string | Date | null
  className?: string
}

export function SignatureDisplay({
  signature,
  mime,
  label = "Firma",
  date,
  className = "",
}: SignatureDisplayProps) {
  const { formatDate } = useCurrency()
  const dataUrl = `data:${mime};base64,${signature}`

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <PenTool className="h-4 w-4 text-muted-foreground" />
        {label}
      </div>
      <div className="border rounded-lg p-2 bg-white dark:bg-slate-100">
        <img
          src={dataUrl}
          alt={label}
          className="max-h-24 w-auto"
        />
      </div>
      {date && (
        <p className="text-xs text-muted-foreground">
          Firmado el {formatDate(date)}
        </p>
      )}
    </div>
  )
}

interface SignatureCardProps {
  signature: string
  mime: string
  title?: string
  date?: string | Date | null
}

export function SignatureCard({
  signature,
  mime,
  title = "Firma del Cliente",
  date,
}: SignatureCardProps) {
  const { formatDate } = useCurrency()
  const dataUrl = `data:${mime};base64,${signature}`

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 font-medium">
            <PenTool className="h-4 w-4" />
            {title}
          </div>
          <div className="border rounded-lg p-3 bg-white dark:bg-slate-100">
            <img
              src={dataUrl}
              alt={title}
              className="max-h-32 w-auto mx-auto"
            />
          </div>
          {date && (
            <p className="text-sm text-muted-foreground text-center">
              Firmado el {formatDate(date)}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
