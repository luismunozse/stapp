"use client"

import { Label } from "@/components/ui/label"
import { Loader2 } from "lucide-react"

interface TipoDispositivoPickerProps {
  tipos: Array<{ codigo: string; nombre: string }>
  value: string
  onChange: (codigo: string) => void
  loading: boolean
  error?: string
  label?: string
}

export function TipoDispositivoPicker({
  tipos,
  value,
  onChange,
  loading,
  error,
  label = "Tipo de Dispositivo *",
}: TipoDispositivoPickerProps) {
  return (
    <div>
      <Label>{label}</Label>
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className={`grid gap-2 mt-2 ${
          tipos.length <= 5
            ? "grid-cols-3 sm:grid-cols-5"
            : tipos.length <= 8
            ? "grid-cols-3 sm:grid-cols-4"
            : "grid-cols-3 sm:grid-cols-4 lg:grid-cols-5"
        }`}>
          {tipos.map((tipo) => (
            <button
              key={tipo.codigo}
              type="button"
              onClick={() => onChange(tipo.codigo)}
              className={`flex flex-col items-center justify-center p-3 border rounded-lg transition-all ${
                value === tipo.codigo
                  ? "bg-primary text-primary-foreground border-primary shadow-md scale-105"
                  : "hover:bg-muted hover:border-primary/50"
              }`}
            >
              <span className="text-xs font-medium truncate w-full text-center">{tipo.nombre}</span>
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="text-sm text-destructive mt-1">
          {error}
        </p>
      )}
    </div>
  )
}
