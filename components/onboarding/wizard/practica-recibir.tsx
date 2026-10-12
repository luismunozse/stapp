"use client"

import { useRef, useState } from "react"
import { ChevronLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { t, type Terminologia } from "@/lib/terminologia"
import { Chips } from "./chips"
import type { NuevaPractica } from "./practica-api"
import { marcasParaPractica, problemasParaPractica } from "./wizard-state"
import type { TipoPractica } from "./types"

interface PracticaRecibirProps {
  tipos: TipoPractica[]
  terminologia: Terminologia
  ownerEmail: string
  enviando: boolean
  onEnviar: (body: NuevaPractica) => void
  onAtras: () => void
}

const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 text-base sm:text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50"

export function PracticaRecibir({ tipos, terminologia, ownerEmail, enviando, onEnviar, onAtras }: PracticaRecibirProps) {
  const [tipoCodigo, setTipoCodigo] = useState(tipos[0]?.codigo ?? "")
  const [dispositivo, setDispositivo] = useState("")
  const [problema, setProblema] = useState("")
  const dispositivoRef = useRef<HTMLInputElement>(null)

  // Derived, not synced: if the tipos change (router.refresh after a rubro
  // change) the selection falls back to the first active tipo without an effect.
  const tipo = tipos.find((opcion) => opcion.codigo === tipoCodigo) ?? tipos[0]
  const equipo = t(terminologia, "equipo")

  if (!tipo) {
    return (
      <div className="space-y-4">
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          Para practicar necesitás al menos un tipo de {equipo.toLowerCase()} activo. Podés omitir este paso y activarlo
          después en Configuración.
        </p>
        <Button type="button" variant="ghost" onClick={onAtras}>
          <ChevronLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          Atrás
        </Button>
      </div>
    )
  }

  const marcas = marcasParaPractica(tipo)
  const problemas = problemasParaPractica(tipo)
  const completo = dispositivo.trim() !== "" && problema.trim() !== ""

  const elegirMarca = (marca: string) => {
    setDispositivo(`${marca} `)
    dispositivoRef.current?.focus()
  }

  const enviar = (e: React.FormEvent) => {
    e.preventDefault()
    if (!completo || enviando) return
    onEnviar({ tipoDispositivo: tipo.codigo, dispositivo: dispositivo.trim(), problemaReportado: problema.trim() })
  }

  return (
    <form onSubmit={enviar} className="space-y-4" noValidate>
      <fieldset disabled={enviando} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="practica-tipo">Tipo</Label>
          <select
            id="practica-tipo"
            value={tipo.codigo}
            onChange={(e) => setTipoCodigo(e.target.value)}
            className={SELECT_CLASS}
          >
            {tipos.map((opcion) => (
              <option key={opcion.codigo} value={opcion.codigo}>
                {opcion.nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="practica-dispositivo">{equipo}</Label>
          <Input
            id="practica-dispositivo"
            ref={dispositivoRef}
            value={dispositivo}
            onChange={(e) => setDispositivo(e.target.value)}
            placeholder="Marca y modelo"
            autoComplete="off"
            maxLength={120}
          />
          {marcas.length > 0 && (
            <Chips
              etiqueta="Marcas sugeridas"
              opciones={marcas}
              activa={(marca) => dispositivo.trim().toLowerCase().startsWith(marca.toLowerCase())}
              onElegir={elegirMarca}
            />
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="practica-problema">Problema</Label>
          <Input
            id="practica-problema"
            value={problema}
            onChange={(e) => setProblema(e.target.value)}
            placeholder="¿Qué le pasa?"
            autoComplete="off"
            maxLength={200}
          />
          <Chips
            etiqueta="Problemas comunes"
            opciones={problemas}
            activa={(opcion) => problema.trim() === opcion}
            onElegir={setProblema}
          />
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium">Cliente</p>
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">Vos · {ownerEmail}</p>
          <p className="text-xs text-muted-foreground">
            Usamos tu email para que veas los avisos que le llegan al cliente.
          </p>
        </div>
      </fieldset>

      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-between">
        <Button type="submit" disabled={!completo || enviando}>
          {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {enviando ? "Cargando…" : "Cargar orden de práctica"}
        </Button>
        <Button type="button" variant="ghost" onClick={onAtras} disabled={enviando}>
          <ChevronLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          Atrás
        </Button>
      </div>
    </form>
  )
}
