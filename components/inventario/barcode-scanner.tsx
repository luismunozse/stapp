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
import { ScanLine, Search, AlertCircle, Bug } from "lucide-react"

interface ScanResult {
  found: boolean
  code: string
  item?: any
  matchedByCodigo?: boolean
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
  const [debug, setDebug] = useState(false)
  const [debugLog, setDebugLog] = useState<string[]>([])
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

  // Generic HID keyboard-wedge scanner detection. Works with any market scanner:
  // - With suffix (Enter, Tab, CR, LF, NumpadEnter): finalizes on suffix.
  // - Without suffix: detects scanner-mode by speed (gaps < 30ms) and finalizes on idle (80ms).
  // - Slow scanners: 250ms inter-key tolerance before resetting buffer.
  // - Manual typing: ignored (gaps too large to enter scanner-mode).
  useEffect(() => {
    if (!open) return
    let buf = ""
    let last = 0
    let scannerMode = false
    let fastChars = 0
    let idleTimer: ReturnType<typeof setTimeout> | null = null

    const FAST_GAP = 30          // ms: gap below this = scanner burst
    const RESET_GAP = 250        // ms: gap above this resets buffer
    const IDLE_FINALIZE = 80     // ms: idle period to finalize when no suffix
    const MIN_LEN = 4

    const finalize = () => {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
      if (buf.length >= MIN_LEN) {
        const code = buf
        setCode(code)
        runSearch(code)
      }
      buf = ""
      scannerMode = false
      fastChars = 0
    }

    const isSuffix = (e: KeyboardEvent) =>
      e.key === "Enter" || e.key === "Tab" ||
      e.code === "NumpadEnter" || e.code === "Enter"

    const onKey = (e: KeyboardEvent) => {
      const now = Date.now()
      const gap = now - last
      last = now

      if (debug) {
        const entry = `${e.key} | code=${e.code} | gap=${gap}ms`
        setDebugLog((prev) => [...prev.slice(-15), entry])
      }

      if (isSuffix(e)) {
        if (buf.length >= MIN_LEN && (scannerMode || gap < 100)) {
          e.preventDefault()
          e.stopPropagation()
          finalize()
        } else {
          buf = ""
          scannerMode = false
          fastChars = 0
        }
        return
      }

      // Skip modifier-only or non-printable keys (Shift/Ctrl/Alt/Arrow/F-keys)
      if (e.key.length !== 1) return

      // Long gap = new input session
      if (gap > RESET_GAP) {
        buf = ""
        scannerMode = false
        fastChars = 0
      }

      buf += e.key

      // Promote to scanner-mode after 3 fast consecutive chars
      if (gap < FAST_GAP) {
        fastChars++
        if (fastChars >= 2) scannerMode = true
      } else {
        fastChars = 0
      }

      // Auto-finalize on idle for scanners with no suffix
      if (idleTimer) clearTimeout(idleTimer)
      if (scannerMode) {
        idleTimer = setTimeout(() => {
          if (buf.length >= MIN_LEN) finalize()
          else { buf = ""; scannerMode = false; fastChars = 0 }
        }, IDLE_FINALIZE)
      }
    }

    window.addEventListener("keydown", onKey, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      if (idleTimer) clearTimeout(idleTimer)
    }
  }, [open, runSearch, debug])

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

          <div className="flex items-center justify-between border-t pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => { setDebug(!debug); setDebugLog([]) }}
            >
              <Bug className="h-3.5 w-3.5" />
              {debug ? "Diagnóstico ON" : "Diagnóstico"}
            </Button>
            {debug && debugLog.length > 0 && (
              <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={() => setDebugLog([])}>
                Limpiar
              </Button>
            )}
          </div>

          {debug && (
            <div className="rounded-md border bg-muted/30 p-2 max-h-48 overflow-auto font-mono text-[10px] space-y-0.5">
              {debugLog.length === 0 ? (
                <div className="text-muted-foreground italic">Escaneá ahora — voy a mostrar cada tecla recibida...</div>
              ) : (
                debugLog.map((entry, i) => <div key={i}>{entry}</div>)
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
