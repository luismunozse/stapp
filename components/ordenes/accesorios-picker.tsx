"use client"

import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Plus, X } from "lucide-react"

interface AccesoriosPickerProps {
  disponibles: Array<{ id: string; label: string }>
  seleccionados: string[]
  onToggle: (id: string) => void
  otro: string
  onOtroChange: (value: string) => void
  onOtroAdd: () => void
}

export function AccesoriosPicker({
  disponibles,
  seleccionados,
  onToggle,
  otro,
  onOtroChange,
  onOtroAdd,
}: AccesoriosPickerProps) {
  return (
    <div>
      <Label>Accesorios Recibidos</Label>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
        {disponibles.map((acc) => (
          <label
            key={acc.id}
            className={`flex items-center gap-2 p-2 border rounded cursor-pointer transition-colors ${
              seleccionados.includes(acc.id)
                ? "bg-primary/10 border-primary"
                : "hover:bg-muted"
            }`}
          >
            <input
              type="checkbox"
              checked={seleccionados.includes(acc.id)}
              onChange={() => onToggle(acc.id)}
              className="sr-only"
            />
            <div
              className={`w-4 h-4 border rounded flex items-center justify-center ${
                seleccionados.includes(acc.id)
                  ? "bg-primary border-primary text-white"
                  : "border-gray-300"
              }`}
            >
              {seleccionados.includes(acc.id) && (
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </div>
            <span className="text-sm">{acc.label}</span>
          </label>
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        <Input
          value={otro}
          onChange={(e) => onOtroChange(e.target.value)}
          placeholder="Otro accesorio..."
          className="flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              onOtroAdd()
            }
          }}
        />
        <Button type="button" variant="outline" onClick={onOtroAdd}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {seleccionados.filter((a) => !disponibles.find((c) => c.id === a)).length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {seleccionados
            .filter((a) => !disponibles.find((c) => c.id === a))
            .map((acc) => (
              <span
                key={acc}
                className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded text-sm"
              >
                {acc}
                <button
                  type="button"
                  onClick={() => onToggle(acc)}
                  className="hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
        </div>
      )}
    </div>
  )
}
