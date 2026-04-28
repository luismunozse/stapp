"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScanLine, Search, AlertCircle } from "lucide-react"

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
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadingRef = useRef(false)

  const runSearch = useCallback(async (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/inventario/barcode?code=${encodeURIComponent(trimmed)}`)
      if (res.ok) {
        const data = await res.json()
        onOpenChange(false)
        setCode("")
        onResult(data)
      } else {
        setError("Error al buscar el código. Intentá de nuevo.")
      }
    } catch {
      setError("Sin conexión. Verificá la red e intentá de nuevo.")
    } finally {
      setLoading(false)
      loadingRef.current = false
    }
  }, [onResult, onOpenChange])

  const handleSearch = useCallback(() => runSearch(code), [code, runSearch])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleSearch()
    }
  }

  // Global wedge-scanner listener: captures rapid keystrokes ending in Enter/Tab
  // even if the input lost focus during the Radix Dialog open animation.
  useEffect(() => {
    if (!open) return
    let buf = ""
    let last = 0
    const onKey = (e: KeyboardEvent) => {
      const now = Date.now()
      if (now - last > 200) buf = ""
      last = now
      if (e.key === "Enter" || e.key === "Tab") {
        if (buf.length >= 4) {
          e.preventDefault()
          e.stopPropagation()
          setCode(buf)
          runSearch(buf)
        }
        buf = ""
        return
      }
      if (e.key.length === 1) buf += e.key
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [open, runSearch])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-sm"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          setTimeout(() => inputRef.current?.focus(), 50)
        }}
      >
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
              ref={inputRef}
              placeholder="Código de barras..."
              value={code}
              onChange={(e) => { setCode(e.target.value); setError(null) }}
              onKeyDown={handleKeyDown}
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

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
