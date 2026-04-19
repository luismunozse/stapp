"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Archive, Tag, Percent, X, Printer, Truck } from "lucide-react"
import { useModal } from "@/contexts/modal-context"

interface ProveedorLite {
  id: string
  nombre: string
  activo?: boolean
}

interface InventarioBulkBarProps {
  selectedCount: number
  selectedIds: string[]
  categoriasDisponibles: string[]
  proveedores?: ProveedorLite[]
  onClear: () => void
  onSuccess: () => void
  onGenerateLabels?: () => void
}

export function InventarioBulkBar({
  selectedCount,
  selectedIds,
  categoriasDisponibles,
  proveedores = [],
  onClear,
  onSuccess,
  onGenerateLabels,
}: InventarioBulkBarProps) {
  const { confirm, showError, showSuccess } = useModal()
  const [pending, setPending] = useState(false)
  const [categoria, setCategoria] = useState("")
  const [percent, setPercent] = useState("")
  const [target, setTarget] = useState<"precioVenta" | "precioCompra">("precioVenta")
  const [proveedorSel, setProveedorSel] = useState<string>("")

  const runBulk = async (
    action: "archive" | "set_category" | "price_adjust" | "set_proveedor",
    payload?: Record<string, unknown>
  ) => {
    setPending(true)
    try {
      const res = await fetch("/api/inventario/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, action, payload }),
      })
      const json = await res.json()
      if (!res.ok) {
        await showError(json.error || "Error al ejecutar la acción")
        return
      }
      await showSuccess(`${json.updated} item${json.updated === 1 ? "" : "s"} actualizados`)
      onClear()
      onSuccess()
    } catch {
      await showError("Error de red al ejecutar la acción")
    } finally {
      setPending(false)
    }
  }

  const handleArchive = async () => {
    const ok = await confirm({
      title: "Archivar items",
      description: `¿Archivar ${selectedCount} item${selectedCount === 1 ? "" : "s"}? No aparecerán en búsquedas ni ventas, pero se conservan los movimientos.`,
      confirmText: "Archivar",
      cancelText: "Cancelar",
      variant: "danger",
    })
    if (!ok) return
    await runBulk("archive")
  }

  const handleSetCategory = async () => {
    if (!categoria) {
      await showError("Seleccioná una categoría")
      return
    }
    await runBulk("set_category", { categoria })
    setCategoria("")
  }

  const handleSetProveedor = async () => {
    if (!proveedorSel) {
      await showError("Seleccioná un proveedor o 'Sin proveedor'")
      return
    }
    const proveedorId = proveedorSel === "none" ? null : proveedorSel
    const nombre = proveedorId
      ? proveedores.find((p) => p.id === proveedorId)?.nombre || "el proveedor"
      : "Sin proveedor"
    const ok = await confirm({
      title: "Cambiar proveedor",
      description: `¿Asignar "${nombre}" a ${selectedCount} item${selectedCount === 1 ? "" : "s"}?`,
      confirmText: "Aplicar",
      cancelText: "Cancelar",
      variant: "info",
    })
    if (!ok) return
    await runBulk("set_proveedor", { proveedorId })
    setProveedorSel("")
  }

  const handlePriceAdjust = async () => {
    const num = parseFloat(percent)
    if (isNaN(num) || num === 0) {
      await showError("Ingresá un porcentaje distinto de cero")
      return
    }
    const ok = await confirm({
      title: "Ajustar precio",
      description: `${num > 0 ? "Aumentar" : "Reducir"} el ${target === "precioVenta" ? "precio de venta" : "costo"} de ${selectedCount} item${selectedCount === 1 ? "" : "s"} en ${Math.abs(num)}%?`,
      confirmText: "Aplicar",
      cancelText: "Cancelar",
      variant: "info",
    })
    if (!ok) return
    await runBulk("price_adjust", { percent: num, target })
    setPercent("")
  }

  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 rounded-lg border bg-primary/5 px-4 py-2 shadow-sm">
      <span className="text-sm font-medium">
        {selectedCount} seleccionado{selectedCount === 1 ? "" : "s"}
      </span>
      <div className="flex flex-wrap items-center gap-2 ml-auto">
        {/* Cambiar categoría */}
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" disabled={pending}>
              <Tag className="mr-2 h-4 w-4" />
              Categoría
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-2">
            <div className="text-sm font-medium">Cambiar categoría</div>
            <Select value={categoria} onValueChange={setCategoria}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                {categoriasDisponibles.map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" className="w-full" onClick={handleSetCategory} disabled={pending || !categoria}>
              Aplicar
            </Button>
          </PopoverContent>
        </Popover>

        {/* Ajustar precio */}
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" disabled={pending}>
              <Percent className="mr-2 h-4 w-4" />
              Precio
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-2">
            <div className="text-sm font-medium">Ajustar precio</div>
            <Select value={target} onValueChange={(v) => setTarget(v as "precioVenta" | "precioCompra")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="precioVenta">Precio de venta</SelectItem>
                <SelectItem value="precioCompra">Costo</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.01"
                placeholder="ej: 10 o -5"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Positivo para aumentar, negativo para reducir.
            </p>
            <Button size="sm" className="w-full" onClick={handlePriceAdjust} disabled={pending || !percent}>
              Aplicar
            </Button>
          </PopoverContent>
        </Popover>

        {/* Cambiar proveedor */}
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" disabled={pending}>
              <Truck className="mr-2 h-4 w-4" />
              Proveedor
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-2">
            <div className="text-sm font-medium">Cambiar proveedor</div>
            <Select value={proveedorSel} onValueChange={setProveedorSel}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin proveedor</SelectItem>
                {proveedores
                  .filter((p) => p.activo !== false)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="w-full"
              onClick={handleSetProveedor}
              disabled={pending || !proveedorSel}
            >
              Aplicar
            </Button>
          </PopoverContent>
        </Popover>

        {/* Etiquetas */}
        {onGenerateLabels && (
          <Button size="sm" variant="outline" onClick={onGenerateLabels} disabled={pending}>
            <Printer className="mr-2 h-4 w-4" />
            Etiquetas
          </Button>
        )}

        {/* Archivar */}
        <Button size="sm" variant="outline" onClick={handleArchive} disabled={pending} className="text-destructive hover:text-destructive">
          <Archive className="mr-2 h-4 w-4" />
          Archivar
        </Button>

        <Button size="sm" variant="ghost" onClick={onClear} disabled={pending}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
