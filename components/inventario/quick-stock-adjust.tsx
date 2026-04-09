"use client"

import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, Minus, AlertCircle } from "lucide-react"
import { useModal } from "@/contexts/modal-context"

interface QuickStockAdjustProps {
  itemId: string
  currentStock: number
  esStockBajo?: boolean
  sinStock?: boolean
  onAdjusted: () => void
}

export function QuickStockAdjust({
  itemId,
  currentStock,
  esStockBajo,
  sinStock,
  onAdjusted,
}: QuickStockAdjustProps) {
  const { showError } = useModal()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<"delta" | "absolute">("delta")
  const [value, setValue] = useState("")
  const [motivo, setMotivo] = useState("")
  const [pending, setPending] = useState(false)

  const reset = () => {
    setValue("")
    setMotivo("")
    setMode("delta")
  }

  const handleSubmit = async () => {
    const num = parseInt(value, 10)
    if (isNaN(num)) {
      await showError("Ingresá un número válido")
      return
    }
    if (mode === "delta" && num === 0) {
      await showError("El delta no puede ser cero")
      return
    }
    if (mode === "absolute" && num < 0) {
      await showError("El stock no puede ser negativo")
      return
    }

    setPending(true)
    try {
      const res = await fetch(`/api/inventario/${itemId}/stock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, value: num, motivo: motivo || undefined }),
      })
      const json = await res.json()
      if (!res.ok) {
        await showError(json.error || "Error al ajustar stock")
        return
      }
      onAdjusted()
      setOpen(false)
      reset()
    } catch {
      await showError("Error de red al ajustar stock")
    } finally {
      setPending(false)
    }
  }

  const stockClass = sinStock
    ? "text-destructive"
    : esStockBajo
      ? "text-amber-600"
      : ""

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex items-center justify-center gap-1 font-bold hover:bg-muted/60 rounded px-2 py-0.5 transition-colors ${stockClass}`}
          onClick={(e) => e.stopPropagation()}
          title="Ajustar stock"
        >
          {currentStock}
          {esStockBajo && <AlertCircle className="h-3 w-3 text-amber-600" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <div className="text-sm font-medium">Ajustar stock</div>
          <div className="text-xs text-muted-foreground">
            Stock actual: <span className="font-semibold">{currentStock}</span>
          </div>
        </div>

        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={mode === "delta" ? "default" : "outline"}
            className="flex-1"
            onClick={() => setMode("delta")}
          >
            +/-
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "absolute" ? "default" : "outline"}
            className="flex-1"
            onClick={() => setMode("absolute")}
          >
            Set
          </Button>
        </div>

        {mode === "delta" ? (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-9 w-9 shrink-0"
              onClick={() => {
                const n = parseInt(value || "0", 10) || 0
                setValue(String(n - 1))
              }}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Input
              type="number"
              placeholder="ej: 5 o -3"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="text-center"
              autoFocus
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-9 w-9 shrink-0"
              onClick={() => {
                const n = parseInt(value || "0", 10) || 0
                setValue(String(n + 1))
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Input
            type="number"
            min={0}
            placeholder="Nuevo stock"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        )}

        <Input
          placeholder="Motivo (opcional)"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          maxLength={500}
        />

        <Button
          className="w-full"
          size="sm"
          onClick={handleSubmit}
          disabled={pending || !value}
        >
          {pending ? "Guardando..." : "Guardar"}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
