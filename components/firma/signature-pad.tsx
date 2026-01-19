"use client"

import { useRef, useState, useEffect } from "react"
import SignatureCanvas from "react-signature-canvas"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Trash2, Check, PenTool } from "lucide-react"

interface SignaturePadProps {
  label?: string
  onSignatureChange: (data: string | null, mime: string | null) => void
  initialSignature?: string | null
  initialMime?: string | null
  disabled?: boolean
}

export function SignaturePad({
  label = "Firma del Cliente",
  onSignatureChange,
  initialSignature,
  initialMime,
  disabled = false,
}: SignaturePadProps) {
  const sigCanvas = useRef<SignatureCanvas>(null)
  const [isEmpty, setIsEmpty] = useState(true)
  const [hasInitial, setHasInitial] = useState(false)

  useEffect(() => {
    if (initialSignature && initialMime && sigCanvas.current) {
      // Load initial signature
      const dataUrl = `data:${initialMime};base64,${initialSignature}`
      sigCanvas.current.fromDataURL(dataUrl)
      setIsEmpty(false)
      setHasInitial(true)
    }
  }, [initialSignature, initialMime])

  const handleClear = () => {
    if (sigCanvas.current) {
      sigCanvas.current.clear()
      setIsEmpty(true)
      setHasInitial(false)
      onSignatureChange(null, null)
    }
  }

  const handleEnd = () => {
    if (sigCanvas.current && !sigCanvas.current.isEmpty()) {
      setIsEmpty(false)
      // Get base64 data without the prefix
      const dataUrl = sigCanvas.current.toDataURL("image/png")
      const base64Match = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/)
      if (base64Match) {
        onSignatureChange(base64Match[2], base64Match[1])
      }
    }
  }

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2">
        <PenTool className="h-4 w-4" />
        {label}
      </Label>
      <div
        className={`relative border-2 rounded-lg bg-white ${
          disabled ? "opacity-50 pointer-events-none" : "border-dashed border-input"
        }`}
      >
        <SignatureCanvas
          ref={sigCanvas}
          canvasProps={{
            className: "w-full h-32 rounded-lg",
            style: { touchAction: "none" },
          }}
          backgroundColor="white"
          penColor="black"
          onEnd={handleEnd}
        />
        {isEmpty && !hasInitial && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-muted-foreground text-sm">
              Firme aqui con el dedo o mouse
            </span>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleClear}
          disabled={disabled || (isEmpty && !hasInitial)}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Limpiar
        </Button>
        {!isEmpty && (
          <span className="flex items-center text-sm text-green-600 dark:text-green-400">
            <Check className="mr-1 h-4 w-4" />
            Firma capturada
          </span>
        )}
      </div>
    </div>
  )
}
