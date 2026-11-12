"use client"

import * as React from "react"
import { Input, type InputProps } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { parseMonto, formatMontoInput } from "@/lib/parse-money"
import { round2 } from "@/lib/ventas/totales"

export interface MontoInfo {
  /** Lo que hay escrito en el input. */
  texto: string
  /** Hay texto pero no es un monto (por ejemplo "1.2.3"). El valor emitido es null. */
  invalido: boolean
}

export interface MoneyInputProps
  extends Omit<InputProps, "type" | "inputMode" | "value" | "defaultValue" | "onChange" | "min" | "max" | "step"> {
  /** Monto actual; null = vacío. */
  value: number | null
  /** Se llama en cada tecla con el monto ya parseado y redondeado a centavos (null si está vacío o es inválido). */
  onValueChange: (value: number | null, info: MontoInfo) => void
  /** Deja escribir el signo menos. Por defecto no. */
  allowNegative?: boolean
}

/** Monto redondeado a centavos, o null si está vacío o es inválido. */
function parsear(texto: string): number | null {
  const n = parseMonto(texto)
  return n === null ? null : round2(n)
}

function mismoMonto(a: number | null, b: number | null) {
  if (a === null || b === null) return a === b
  return Math.abs(a - b) < 0.005
}

/**
 * Input de montos único de la app (POS, caja, pagos).
 *
 * - Se escribe con la convención argentina ("1.234,56") y también acepta
 *   "1234.56" o un "$ 1.234,56" pegado; el parseo es siempre `parseMonto`.
 * - Mientras se escribe no se reformatea nada (la coma no se borra); al salir
 *   del campo el texto queda en formato canónico, que además le muestra al
 *   cajero cómo se interpretó lo que escribió.
 * - Si el padre cambia `value` desde afuera (botones de monto rápido, recargo
 *   que recalcula el total) el texto se actualiza.
 * - Con texto inválido queda marcado (`aria-invalid`) y emite null.
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  function MoneyInput(
    { value, onValueChange, allowNegative = false, className, onBlur, placeholder = "0,00", ...props },
    ref
  ) {
    const [texto, setTexto] = React.useState(() => formatMontoInput(value))

    // Cambio externo: solo cuando `value` cambia y no coincide con lo escrito.
    // No se reacciona a cada render, así el cajero puede borrar el campo para
    // reescribirlo sin que vuelva a aparecer el valor anterior.
    React.useEffect(() => {
      setTexto((actual) => (mismoMonto(parsear(actual), value) ? actual : formatMontoInput(value)))
    }, [value])

    const invalido = texto.trim() !== "" && parsear(texto) === null

    return (
      <Input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        aria-invalid={invalido || undefined}
        className={cn(invalido && "border-destructive focus-visible:ring-destructive", className)}
        {...props}
        value={texto}
        onChange={(e) => {
          // Fuera todo lo que no sea número o separador: un "$ 1.234,56"
          // pegado queda "1.234,56" y una letra no llega a escribirse.
          const permitido = allowNegative ? /[^\d.,-]/g : /[^\d.,]/g
          const limpio = e.target.value.replace(permitido, "")
          setTexto(limpio)
          const n = parsear(limpio)
          onValueChange(n, { texto: limpio, invalido: limpio.trim() !== "" && n === null })
        }}
        onBlur={(e) => {
          const n = parsear(texto)
          if (n !== null) setTexto(formatMontoInput(n))
          // Vacío: vuelve al último valor aceptado (un precio que se borró y no
          // se reescribió sigue siendo el de antes).
          else if (texto.trim() === "") setTexto(formatMontoInput(value))
          onBlur?.(e)
        }}
      />
    )
  }
)
