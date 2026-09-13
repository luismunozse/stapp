"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type CondicionFiscal = "MONOTRIBUTO" | "RESPONSABLE_INSCRIPTO"

export interface EstadoDelegacion {
  conectado: boolean
  cuit: string | null
  puntoVenta: number | null
  condicionFiscal: CondicionFiscal | null
}

interface Props {
  allowEdit: boolean
  /** CUIT del certificado de la plataforma: es a quien el taller le delega. */
  cuitPlataforma: string | null
  estadoInicial: EstadoDelegacion
  onGuardado?: (estado: EstadoDelegacion) => void
}

interface Mensaje {
  tone: "ok" | "warn" | "error"
  text: string
}

const TONOS: Record<Mensaje["tone"], string> = {
  ok: "bg-success-50 dark:bg-success/15 border border-success-200 dark:border-success/30 text-success-600 dark:text-success-500",
  warn: "bg-warning-50 dark:bg-warning/15 border border-warning-200 dark:border-warning/30 text-warning-700 dark:text-warning-500",
  error: "bg-destructive/10 border border-destructive/30 text-destructive",
}

export function CredencialesArcaDelegado({
  allowEdit,
  cuitPlataforma,
  estadoInicial,
  onGuardado,
}: Props) {
  const [estado, setEstado] = useState(estadoInicial)
  const [cuit, setCuit] = useState(estadoInicial.cuit ?? "")
  const [puntoVenta, setPuntoVenta] = useState(String(estadoInicial.puntoVenta ?? 1))
  const [condicionFiscal, setCondicionFiscal] = useState<CondicionFiscal>(
    estadoInicial.condicionFiscal ?? "MONOTRIBUTO"
  )
  const [guardando, setGuardando] = useState(false)
  const [probando, setProbando] = useState(false)
  const [mensaje, setMensaje] = useState<Mensaje | null>(null)

  const plataformaLista = !!cuitPlataforma
  const cuitDigitos = cuit.replace(/\D/g, "")
  const puntoVentaNumero = Number(puntoVenta)
  const datosValidos =
    cuitDigitos.length === 11 &&
    Number.isInteger(puntoVentaNumero) &&
    puntoVentaNumero > 0 &&
    puntoVentaNumero <= 99999

  const puedeGuardar = plataformaLista && datosValidos && allowEdit && !guardando
  // Probar consulta la fila guardada: antes de guardar no hay nada que probar.
  const puedeProbar = plataformaLista && estado.conectado && !probando

  async function handleGuardar() {
    setGuardando(true)
    setMensaje(null)
    try {
      const res = await fetch("/api/facturacion-electronica/credenciales", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modo: "delegado",
          cuit: cuitDigitos,
          puntoVenta: puntoVentaNumero,
          condicionFiscal,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMensaje({ tone: "error", text: data?.error || "No se pudo guardar" })
        return
      }
      const nuevo: EstadoDelegacion = {
        conectado: true,
        cuit: data.cuit ?? cuitDigitos,
        puntoVenta: data.puntoVenta ?? puntoVentaNumero,
        condicionFiscal: data.condicionFiscal ?? condicionFiscal,
      }
      setEstado(nuevo)
      onGuardado?.(nuevo)
      setMensaje({ tone: "ok", text: "Datos guardados. Probá la conexión para confirmar la delegación." })
    } catch {
      setMensaje({ tone: "error", text: "Error al guardar" })
    } finally {
      setGuardando(false)
    }
  }

  async function handleProbar() {
    setProbando(true)
    setMensaje(null)
    try {
      const res = await fetch("/api/facturacion-electronica/probar", { method: "POST" })
      const data = await res.json()

      if (!res.ok) {
        setMensaje({ tone: "error", text: data?.error || "No se pudo probar la conexión" })
        return
      }

      if (!data.ok) {
        setMensaje({
          tone: "error",
          text: `ARCA rechazó la operación: ${data.error}. Revisá que la delegación esté hecha y aceptada — puede tardar hasta 24 h.`,
        })
        return
      }

      const puntos: Array<{ numero: number; bloqueado: boolean }> = data.puntosVenta ?? []
      if (puntos.length === 0) {
        // 602: AFIP nos atendió en nombre del taller pero no encontró nada que
        // listar. La delegación funciona; falta el alta del punto de venta.
        setMensaje({
          tone: "warn",
          text: "La delegación funciona, pero ARCA responde sin puntos de venta dados de alta. Creá uno en ARCA para poder emitir.",
        })
        return
      }

      setMensaje({
        tone: "ok",
        text: `Conexión OK. ARCA reconoce: ${puntos
          .map((p) => `punto de venta ${p.numero}${p.bloqueado ? " (bloqueado)" : ""}`)
          .join(", ")}.`,
      })
    } catch {
      setMensaje({ tone: "error", text: "Error al probar la conexión" })
    } finally {
      setProbando(false)
    }
  }

  return (
    <div className="space-y-4">
      {!plataformaLista ? (
        <div className={`px-3 py-2 rounded text-sm ${TONOS.error}`}>
          La facturación electrónica no está disponible en este momento. Es un problema de
          configuración de la plataforma, no de tu cuenta — escribinos y lo resolvemos.
        </div>
      ) : (
        <div className="rounded-lg border p-3 space-y-2">
          <p className="text-sm font-medium">Autorizanos a facturar en tu nombre</p>
          <p className="text-xs text-muted-foreground">
            No necesitás certificados ni instalar nada. Entrá a ARCA con tu Clave Fiscal y delegá el
            servicio:
          </p>
          <ol className="text-xs text-muted-foreground list-decimal ml-4 space-y-1">
            <li>Administrador de Relaciones de Clave Fiscal → Nueva Relación</li>
            <li>Servicio → Buscar → ARCA → WebServices → Facturación Electrónica</li>
            {/*
              Se muestra SIN guiones a propósito: este número se copia y se
              pega en el formulario de ARCA, que pide el CUIT "sin guiones ni
              separadores de ningún tipo". Formatearlo lindo invita a pegar
              algo que ARCA rechaza.
            */}
            <li>
              En &quot;Representante&quot;, ingresá este CUIT:{" "}
              <span className="font-mono font-semibold text-foreground select-all">
                {cuitPlataforma}
              </span>
            </li>
            <li>Confirmar. La autorización puede tardar hasta 24 h en quedar activa.</li>
          </ol>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="delCuit" className="text-sm">CUIT del taller</Label>
          <Input
            id="delCuit"
            value={cuit}
            onChange={(e) => setCuit(e.target.value)}
            placeholder="30712345678"
            inputMode="numeric"
            disabled={!allowEdit || !plataformaLista}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            El comprobante sale a nombre de este CUIT, no del nuestro.
          </p>
        </div>
        <div>
          <Label htmlFor="delPuntoVenta" className="text-sm">Punto de venta</Label>
          <Input
            id="delPuntoVenta"
            type="number"
            min="1"
            max="99999"
            value={puntoVenta}
            onChange={(e) => setPuntoVenta(e.target.value)}
            disabled={!allowEdit || !plataformaLista}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            El que diste de alta en ARCA para facturación electrónica.
          </p>
        </div>
      </div>

      <div className="sm:w-1/2">
        <Label htmlFor="delCondicionFiscal" className="text-sm">Condición fiscal</Label>
        <Select
          value={condicionFiscal}
          onValueChange={(v) => setCondicionFiscal(v as CondicionFiscal)}
          disabled={!allowEdit || !plataformaLista}
        >
          <SelectTrigger id="delCondicionFiscal">
            <SelectValue placeholder="Seleccionar condición fiscal" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="MONOTRIBUTO">Monotributo (Factura C)</SelectItem>
            <SelectItem value="RESPONSABLE_INSCRIPTO">Responsable Inscripto (Factura B)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mensaje && <div className={`px-3 py-2 rounded text-sm ${TONOS[mensaje.tone]}`}>{mensaje.text}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={handleGuardar} disabled={!puedeGuardar}>
          {guardando ? "Guardando..." : "Guardar"}
        </Button>
        <Button type="button" variant="outline" onClick={handleProbar} disabled={!puedeProbar}>
          {probando ? "Probando..." : "Probar conexión"}
        </Button>
        {estado.conectado && (
          <span className="text-sm text-muted-foreground">
            CUIT {estado.cuit}
            {estado.puntoVenta ? ` · Punto de venta ${estado.puntoVenta}` : ""}
          </span>
        )}
      </div>
    </div>
  )
}
