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
import { clasificarPem, leerArchivoComoTexto, type TipoPem } from "@/lib/facturacion/arca/pem-upload"

type CondicionFiscal = "MONOTRIBUTO" | "RESPONSABLE_INSCRIPTO"

export interface EstadoCredencialesArca {
  conectado: boolean
  cuit: string | null
  puntoVenta: number | null
  certSubject: string | null
  certNotAfter: string | null
  estado: string | null
  condicionFiscal: CondicionFiscal | null
}

interface CredencialesArcaProps {
  allowEdit: boolean
  estadoInicial: EstadoCredencialesArca
  onConectado?: (estado: EstadoCredencialesArca) => void
}

interface Mensaje {
  type: "success" | "error"
  text: string
}

const ESPERADO: Record<"certificado" | "clave", { label: string; ext: string }> = {
  certificado: { label: "el certificado", ext: ".crt" },
  clave: { label: "la clave privada", ext: ".key" },
}

/**
 * Traduce lo que realmente subieron a un mensaje accionable. El caso que más
 * soporte genera es el `.csr`: queda al lado del `.crt` en la misma carpeta
 * y, sin este aviso, el error del servidor es solo "no es un PEM válido".
 */
function explicarArchivoIncorrecto(tipo: TipoPem, esperado: "certificado" | "clave"): string {
  const { label, ext } = ESPERADO[esperado]
  if (tipo === "solicitud") {
    return `Ese archivo es la solicitud de certificado (.csr), no ${label}. Subí el ${ext} que te devolvió ARCA.`
  }
  if (tipo === "certificado") return `Ese archivo es el certificado, no ${label}.`
  if (tipo === "clave") return `Ese archivo es la clave privada, no ${label}.`
  return `No se reconoce el contenido del archivo. Tiene que ser ${label} en formato PEM (${ext}).`
}

function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

export function CredencialesArca({ allowEdit, estadoInicial, onConectado }: CredencialesArcaProps) {
  const [estado, setEstado] = useState(estadoInicial)
  const [certPem, setCertPem] = useState("")
  const [keyPem, setKeyPem] = useState("")
  const [certNombre, setCertNombre] = useState("")
  const [keyNombre, setKeyNombre] = useState("")
  const [cuit, setCuit] = useState(estadoInicial.cuit ?? "")
  const [puntoVenta, setPuntoVenta] = useState(String(estadoInicial.puntoVenta ?? 1))
  const [condicionFiscal, setCondicionFiscal] = useState<CondicionFiscal>(
    estadoInicial.condicionFiscal ?? "MONOTRIBUTO"
  )
  const [conectando, setConectando] = useState(false)
  const [mensaje, setMensaje] = useState<Mensaje | null>(null)

  const cuitDigitos = cuit.replace(/\D/g, "")
  // ARCA numera los puntos de venta con 5 dígitos; el servidor valida igual,
  // esto solo evita el viaje.
  const puntoVentaNumero = Number(puntoVenta)
  const puntoVentaValido =
    Number.isInteger(puntoVentaNumero) && puntoVentaNumero > 0 && puntoVentaNumero <= 99999
  const puedeConectar =
    !!certPem && !!keyPem && cuitDigitos.length === 11 && puntoVentaValido && allowEdit
  const certVencido = estado.estado === "cert_vencido"

  async function handleArchivo(
    e: React.ChangeEvent<HTMLInputElement>,
    esperado: "certificado" | "clave"
  ) {
    const input = e.target
    const file = input.files?.[0]
    // Sin este reset, volver a elegir EL MISMO archivo después de corregir no
    // dispara ningún evento y la pantalla parece congelada.
    input.value = ""
    if (!file) return

    setMensaje(null)
    let texto: string
    try {
      texto = await leerArchivoComoTexto(file)
    } catch {
      setMensaje({ type: "error", text: "No se pudo leer el archivo. Probá de nuevo." })
      return
    }

    const tipo = clasificarPem(texto)
    if (tipo !== esperado) {
      setMensaje({ type: "error", text: explicarArchivoIncorrecto(tipo, esperado) })
      return
    }

    if (esperado === "certificado") {
      setCertPem(texto)
      setCertNombre(file.name)
    } else {
      setKeyPem(texto)
      setKeyNombre(file.name)
    }
  }

  async function handleConectar() {
    setConectando(true)
    setMensaje(null)
    try {
      const res = await fetch("/api/facturacion-electronica/credenciales", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          certPem,
          keyPem,
          cuit: cuitDigitos,
          puntoVenta: puntoVentaNumero,
          condicionFiscal,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setMensaje({ type: "error", text: data?.error || "No se pudo conectar" })
        return
      }

      const nuevo: EstadoCredencialesArca = {
        conectado: !!data.conectado,
        cuit: data.cuit ?? cuitDigitos,
        puntoVenta: data.puntoVenta ?? puntoVentaNumero,
        certSubject: data.certSubject ?? null,
        certNotAfter: data.certNotAfter ?? null,
        estado: data.estado ?? "conectado",
        condicionFiscal: data.condicionFiscal ?? condicionFiscal,
      }
      setEstado(nuevo)
      onConectado?.(nuevo)
      // El material sensible no se retiene en memoria del navegador más de lo
      // necesario, y el formulario queda listo para una renovación futura.
      setCertPem("")
      setKeyPem("")
      setCertNombre("")
      setKeyNombre("")
      setMensaje({ type: "success", text: "Certificado cargado correctamente" })
    } catch {
      setMensaje({ type: "error", text: "Error al conectar con ARCA" })
    } finally {
      setConectando(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs sm:text-sm text-muted-foreground">
        Subí el certificado que generaste en ARCA y su clave privada. Se guardan cifrados y no
        vuelven a mostrarse.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="arcaCert" className="text-sm">Certificado (.crt)</Label>
          <input
            id="arcaCert"
            type="file"
            accept=".crt,.pem,.cer"
            onChange={(e) => handleArchivo(e, "certificado")}
            disabled={!allowEdit}
            className="mt-1 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-accent/40 disabled:opacity-50"
          />
          {certNombre && <p className="mt-1 text-xs text-success-600 dark:text-success-500">{certNombre}</p>}
        </div>
        <div>
          <Label htmlFor="arcaKey" className="text-sm">Clave privada (.key)</Label>
          <input
            id="arcaKey"
            type="file"
            accept=".key,.pem"
            onChange={(e) => handleArchivo(e, "clave")}
            disabled={!allowEdit}
            className="mt-1 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-accent/40 disabled:opacity-50"
          />
          {keyNombre && <p className="mt-1 text-xs text-success-600 dark:text-success-500">{keyNombre}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="arcaCuit" className="text-sm">CUIT</Label>
          <Input
            id="arcaCuit"
            value={cuit}
            onChange={(e) => setCuit(e.target.value)}
            placeholder="30712345678"
            inputMode="numeric"
            disabled={!allowEdit}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Tiene que ser el mismo CUIT con el que se emitió el certificado.
          </p>
        </div>
        <div>
          <Label htmlFor="arcaPuntoVenta" className="text-sm">Punto de venta</Label>
          <Input
            id="arcaPuntoVenta"
            type="number"
            min="1"
            max="99999"
            value={puntoVenta}
            onChange={(e) => setPuntoVenta(e.target.value)}
            disabled={!allowEdit}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            El que diste de alta en ARCA para facturación electrónica.
          </p>
        </div>
        <div>
          <Label htmlFor="arcaCondicionFiscal" className="text-sm">Condición fiscal</Label>
          <Select
            value={condicionFiscal}
            onValueChange={(val) => setCondicionFiscal(val as CondicionFiscal)}
            disabled={!allowEdit}
          >
            <SelectTrigger id="arcaCondicionFiscal">
              <SelectValue placeholder="Seleccionar condición fiscal" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MONOTRIBUTO">Monotributo (Factura C)</SelectItem>
              <SelectItem value="RESPONSABLE_INSCRIPTO">Responsable Inscripto (Factura B)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {mensaje && (
        <div
          className={`px-3 py-2 rounded text-sm ${
            mensaje.type === "success"
              ? "bg-success-50 dark:bg-success/15 border border-success-200 dark:border-success/30 text-success-600 dark:text-success-500"
              : "bg-destructive/10 border border-destructive/30 text-destructive"
          }`}
        >
          {mensaje.text}
        </div>
      )}

      {certVencido && (
        <div className="px-3 py-2 rounded text-sm bg-destructive/10 border border-destructive/30 text-destructive">
          El certificado está vencido: no se pueden emitir comprobantes hasta renovarlo en ARCA y
          volver a subirlo.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={handleConectar} disabled={!puedeConectar || conectando}>
          {conectando ? "Conectando..." : "Conectar"}
        </Button>
        {estado.conectado && !certVencido && (
          <span className="text-sm text-success-600 dark:text-success-500">
            Conectado · CUIT {estado.cuit}
            {estado.puntoVenta ? ` · Punto de venta ${estado.puntoVenta}` : ""}
            {estado.certNotAfter ? ` · Vence el ${formatearFecha(estado.certNotAfter)}` : ""}
          </span>
        )}
        {estado.conectado && certVencido && (
          <span className="text-sm text-muted-foreground">CUIT {estado.cuit}</span>
        )}
        {!estado.conectado && <span className="text-sm text-muted-foreground">Sin certificado cargado</span>}
      </div>
    </div>
  )
}
