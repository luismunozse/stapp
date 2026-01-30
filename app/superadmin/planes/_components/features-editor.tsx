"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { X, Plus } from "lucide-react"

interface FeaturesEditorProps {
  features: string[]
  onChange: (features: string[]) => void
  disabled?: boolean
}

export function FeaturesEditor({ features, onChange, disabled }: FeaturesEditorProps) {
  const [newFeature, setNewFeature] = useState("")

  const handleAdd = () => {
    const trimmed = newFeature.trim()
    if (trimmed && !features.includes(trimmed)) {
      onChange([...features, trimmed])
      setNewFeature("")
    }
  }

  const handleRemove = (index: number) => {
    onChange(features.filter((_, i) => i !== index))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleAdd()
    }
  }

  return (
    <div className="space-y-3">
      <Label>Características del Plan</Label>

      {/* Lista de features */}
      <div className="space-y-2">
        {features.map((feature, index) => (
          <div
            key={index}
            className="flex items-center gap-2 p-2 bg-muted rounded-lg"
          >
            <span className="flex-1 text-sm">{feature}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => handleRemove(index)}
              disabled={disabled}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {features.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No hay características agregadas
          </p>
        )}
      </div>

      {/* Input para agregar */}
      <div className="flex gap-2">
        <Input
          placeholder="Ej: Reportes avanzados"
          value={newFeature}
          onChange={(e) => setNewFeature(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleAdd}
          disabled={disabled || !newFeature.trim()}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
