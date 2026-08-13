"use client"

import { useEffect, useReducer, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Loader2, Printer, Usb } from "lucide-react"
import { useThermalPrinter } from "@/components/pos/use-thermal-printer"
import { fitPrintPageToContent } from "@/lib/print-fit-page"
import { readProfile, saveProfile, columnasDefault, type AnchoTermico } from "@/lib/thermal-paper"
import {
  wizardReducer,
  generateColumnsTest, generateCodepageTest, generateCutTest, generateSampleTicket,
  COLUMNAS_CANDIDATAS, CODEPAGE_CANDIDATAS,
} from "@/lib/printer-calibration"
import { toast } from "sonner"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const CODEPAGE_LABELS: Record<string, string> = {
  cp437: "CP437", cp850: "CP850", cp858: "CP858 (estándar)", win1252: "Windows-1252",
}

const CORTE_LABELS: Record<string, string> = {
  gsv: "GS V",
  esci: "ESC i",
  none: "sin corte automático",
}

export function PrinterCalibrationWizard({ open, onOpenChange }: Props) {
  const printer = useThermalPrinter()
  const [state, dispatch] = useReducer(wizardReducer, undefined, () => ({
    step: "conexion" as const,
    profile: readProfile(),
  }))
  const [printing, setPrinting] = useState(false)

  // El wizard queda montado en sus hosts: si se reabre después de que otro
  // control (ej. el toggle 58/80 del host) haya escrito un perfil nuevo, hay
  // que releer el perfil actual en vez de arrastrar el que había al montar.
  const wasOpenRef = useRef(open)
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      dispatch({ type: "sync", profile: readProfile() })
    }
    wasOpenRef.current = open
  }, [open])

  // Con impresora ya conectada (o al conectarse) se saltea el paso de conexión.
  useEffect(() => {
    if (open && printer.connected && state.step === "conexion") dispatch({ type: "conectado" })
  }, [open, printer.connected, state.step])

  const apply = (action: Parameters<typeof wizardReducer>[1]) => {
    const next = wizardReducer(state, action)
    // "reiniciar" solo navega de vuelta a conexión; no debe persistir el
    // perfil vigente en el estado (podría estar stale frente a cambios
    // hechos por el host mientras el wizard estaba en el paso final).
    if (action.type !== "reiniciar") saveProfile(next.profile)
    dispatch(action)
  }

  const printTest = async (data: Uint8Array) => {
    setPrinting(true)
    try {
      const ok = await printer.print(data)
      if (!ok) toast.error("No se pudo imprimir el test")
    } finally {
      setPrinting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Calibrar impresora térmica</DialogTitle>
          <DialogDescription>
            Imprima los tests físicos y elija la opción que se vea correctamente en el papel.
          </DialogDescription>
        </DialogHeader>

        {state.step === "conexion" && (
          <div className="space-y-4">
            {printer.isSupported && (
              <div className="space-y-2">
                <Button
                  className="w-full"
                  onClick={printer.connect}
                  disabled={printer.connecting}
                >
                  {printer.connecting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Usb className="h-4 w-4 mr-2" />
                  )}
                  Conectar impresora USB
                </Button>
                {printer.error && (
                  <p className="text-sm text-destructive">{printer.error}</p>
                )}
              </div>
            )}

            <div className="space-y-2 border-t pt-4">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => printDriverTestPage(state.profile.ancho)}
              >
                <Printer className="h-4 w-4 mr-2" />
                Imprimir página de prueba (navegador)
              </Button>
              <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                <li>Papel: 80mm (o 58mm según su rollo)</li>
                <li>Márgenes: 0</li>
                <li>Escala: 100% (no &quot;ajustar a página&quot;)</li>
              </ul>
            </div>
          </div>
        )}

        {state.step === "columnas" && (
          <div className="space-y-4">
            <p className="font-medium">Test de columnas</p>
            <Button onClick={() => printTest(generateColumnsTest())} disabled={printing}>
              {printing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Printer className="h-4 w-4 mr-2" />}
              Imprimir test
            </Button>
            <p className="text-sm">
              ¿Cuál es la línea más larga donde la barra | quedó en el mismo renglón?
            </p>
            <div className="flex flex-col gap-2">
              {COLUMNAS_CANDIDATAS.map((n, i) => (
                <Button
                  key={n}
                  variant="outline"
                  onClick={() => apply({ type: "columnas", columnas: n })}
                >
                  {i + 1}) {n} columnas
                </Button>
              ))}
            </div>
            <button
              type="button"
              className="text-xs text-muted-foreground underline"
              onClick={() => printTest(generateColumnsTest())}
              disabled={printing}
            >
              Imprimir de nuevo
            </button>
          </div>
        )}

        {state.step === "acentos" && (
          <div className="space-y-4">
            <p className="font-medium">Test de acentos</p>
            <Button onClick={() => printTest(generateCodepageTest())} disabled={printing}>
              {printing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Printer className="h-4 w-4 mr-2" />}
              Imprimir test
            </Button>
            <p className="text-sm">¿En qué número se leen bien los acentos?</p>
            <div className="flex flex-col gap-2">
              {CODEPAGE_CANDIDATAS.map((cp, i) => (
                <Button
                  key={cp}
                  variant="outline"
                  onClick={() => apply({ type: "codepage", codepage: cp })}
                >
                  {i + 1}) {CODEPAGE_LABELS[cp]}
                </Button>
              ))}
            </div>
            <button
              type="button"
              className="text-xs text-muted-foreground underline"
              onClick={() => printTest(generateCodepageTest())}
              disabled={printing}
            >
              Imprimir de nuevo
            </button>
          </div>
        )}

        {state.step === "corte" && (
          <div className="space-y-4">
            <p className="font-medium">Test de corte</p>
            <Button onClick={() => printTest(generateCutTest())} disabled={printing}>
              {printing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Printer className="h-4 w-4 mr-2" />}
              Imprimir test
            </Button>
            <p className="text-sm">¿Después de qué número cortó el papel?</p>
            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={() => apply({ type: "corte", corte: "gsv" })}>
                Cortó después del 1
              </Button>
              <Button variant="outline" onClick={() => apply({ type: "corte", corte: "esci" })}>
                Cortó después del 2
              </Button>
              <Button variant="outline" onClick={() => apply({ type: "corte", corte: "none" })}>
                No corta
              </Button>
            </div>
            <button
              type="button"
              className="text-xs text-muted-foreground underline"
              onClick={() => printTest(generateCutTest())}
              disabled={printing}
            >
              Imprimir de nuevo
            </button>
          </div>
        )}

        {state.step === "final" && (
          <div className="space-y-4">
            <p className="font-medium">Calibración completa</p>
            <p className="text-sm text-muted-foreground">
              {state.profile.ancho}mm · {state.profile.columnas} columnas · {CODEPAGE_LABELS[state.profile.codepage]} · corte {CORTE_LABELS[state.profile.corte]}
            </p>
            <Button
              className="w-full"
              onClick={() => printTest(generateSampleTicket(state.profile))}
              disabled={printing}
            >
              {printing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Printer className="h-4 w-4 mr-2" />}
              Imprimir ticket de prueba
            </Button>
            <button
              type="button"
              className="text-xs text-muted-foreground underline"
              onClick={() => printTest(generateSampleTicket(state.profile))}
              disabled={printing}
            >
              Imprimir de nuevo
            </button>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => apply({ type: "reiniciar" })}>
                Volver a calibrar
              </Button>
              <Button className="flex-1" onClick={() => onOpenChange(false)}>
                Listo
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function printDriverTestPage(ancho: AnchoTermico) {
  const iframe = document.createElement("iframe")
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0"
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument || iframe.contentWindow?.document
  if (!doc) { document.body.removeChild(iframe); return }
  doc.open()
  doc.write(`<!doctype html><html><head><meta charset="utf-8" /><style>
  @page { size: ${ancho}mm auto; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { width: ${ancho}mm; font-family: 'Courier New', monospace; font-size: 12px; color: #000; }
  #test { padding: 2mm; box-sizing: border-box; text-align: center; }
  </style></head><body><div id="test">
  <div><strong>PÁGINA DE PRUEBA</strong></div>
  <div>Ancho configurado: ${ancho}mm</div>
  <div>áéíóúñÑ ¿¡°</div>
  <div>${"1234567890".repeat(5).slice(0, columnasDefault(ancho))}</div>
  <div>Si este texto llega de borde a borde sin cortarse, el driver está bien configurado.</div>
  </div></body></html>`)
  doc.close()
  const trigger = () => {
    fitPrintPageToContent(doc, doc.getElementById("test"), ancho)
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
    setTimeout(() => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe) }, 500)
  }
  if (doc.readyState === "complete") trigger()
  else iframe.onload = trigger
}
