"use client"

import { useState, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScanLine, Search } from "lucide-react"

interface ScanResult {
  found: boolean
  code: string
  item?: any
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onResult: (result: ScanResult) => void
}

export function BarcodeScanner({ open, onOpenChange, onResult }: Props) {
  const [code, setCode] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSearch = useCallback(async () => {
    if (!code.trim()) return
    setLoading(true)
    try {
      const res = await fetch(`/api/inventario/barcode?code=${encodeURIComponent(code.trim())}`)
      if (res.ok) {
        const data = await res.json()
        onOpenChange(false)
        setCode("")
        onResult(data)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [code, onResult, onOpenChange])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleSearch()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-4 w-4" />
            Escáner de Código de Barras
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Ingresá o escaneá el código de barras del producto. Si usás un lector físico, apuntá al campo y escaneá.
          </p>

          <div className="flex gap-2">
            <Input
              placeholder="Código de barras..."
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              className="font-mono"
            />
            <Button onClick={handleSearch} disabled={loading || !code.trim()}>
              <Search className="h-4 w-4" />
            </Button>
          </div>

          {loading && (
            <div className="flex justify-center py-2">
              <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
