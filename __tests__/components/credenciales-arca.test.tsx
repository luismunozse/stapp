/**
 * Tests: carga del certificado ARCA en Configuración.
 *
 * El endpoint PUT ya valida el par cert/clave contra el CUIT; lo que se
 * prueba acá es lo que pasa ANTES de llegar al servidor, que es donde el
 * usuario se traba: subir el archivo equivocado y no entender el error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import React from "react"

import { CredencialesArca } from "@/components/configuracion/credenciales-arca"

const CERT = "-----BEGIN CERTIFICATE-----\nMIID\n-----END CERTIFICATE-----\n"
const KEY = "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----\n"
const CSR = "-----BEGIN CERTIFICATE REQUEST-----\nMIIC\n-----END CERTIFICATE REQUEST-----\n"

const mockFetch = vi.fn()
global.fetch = mockFetch as any

const ESTADO_VACIO = {
  conectado: false,
  cuit: null,
  puntoVenta: null,
  certSubject: null,
  certNotAfter: null,
  estado: null,
  condicionFiscal: null,
}

function subirArchivo(labelText: string, contenido: string, nombre: string) {
  const input = screen.getByLabelText(labelText) as HTMLInputElement
  const file = new File([contenido], nombre, { type: "application/octet-stream" })
  fireEvent.change(input, { target: { files: [file] } })
}

describe("CredencialesArca", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ conectado: true, cuit: "23944498389", certNotAfter: "2028-08-28T22:56:47.000Z" }),
    })
  })

  it("avisa que el archivo es la solicitud (CSR) y no llama al servidor", async () => {
    render(<CredencialesArca allowEdit estadoInicial={ESTADO_VACIO} />)

    subirArchivo("Certificado (.crt)", CSR, "stapp-homo.csr")

    await waitFor(() => {
      expect(screen.getByText(/solicitud de certificado/i)).toBeInTheDocument()
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("manda certPem, keyPem y cuit al conectar", async () => {
    render(<CredencialesArca allowEdit estadoInicial={ESTADO_VACIO} />)

    subirArchivo("Certificado (.crt)", CERT, "stapp-homo.crt")
    subirArchivo("Clave privada (.key)", KEY, "stapp-homo.key")
    fireEvent.change(screen.getByLabelText(/CUIT/i), { target: { value: "23-94449838-9" } })

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /conectar/i })).toBeEnabled()
    })
    fireEvent.click(screen.getByRole("button", { name: /conectar/i }))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))

    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe("/api/facturacion-electronica/credenciales")
    expect(init.method).toBe("PUT")
    expect(JSON.parse(init.body)).toEqual({
      certPem: CERT,
      keyPem: KEY,
      cuit: "23944498389",
      puntoVenta: 1,
      condicionFiscal: "MONOTRIBUTO",
    })
  })

  it("no habilita Conectar mientras falte alguno de los tres datos", async () => {
    render(<CredencialesArca allowEdit estadoInicial={ESTADO_VACIO} />)

    subirArchivo("Certificado (.crt)", CERT, "stapp-homo.crt")
    fireEvent.change(screen.getByLabelText(/CUIT/i), { target: { value: "23944498389" } })

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /conectar/i })).toBeDisabled()
    })
  })

  it("muestra el vencimiento del certificado ya cargado", () => {
    render(
      <CredencialesArca
        allowEdit
        estadoInicial={{
          conectado: true,
          cuit: "23944498389",
          puntoVenta: 3,
          certSubject: "CN=stapp, serialNumber=CUIT 23944498389",
          certNotAfter: "2028-08-28T22:56:47.000Z",
          estado: "conectado",
          condicionFiscal: "MONOTRIBUTO",
        }}
      />
    )

    expect(screen.getByText(/23944498389/)).toBeInTheDocument()
    expect(screen.getByText(/vence/i)).toBeInTheDocument()
  })

  /**
   * `estado` se deriva en lectura del lado del servidor justamente porque la
   * columna puede haber quedado en 'conectado' mientras el certificado
   * vencía. La UI tiene que decirlo fuerte: sin certificado vigente no se
   * emite nada.
   */
  it("avisa cuando el certificado está vencido", () => {
    render(
      <CredencialesArca
        allowEdit
        estadoInicial={{
          conectado: true,
          cuit: "23944498389",
          puntoVenta: 1,
          certSubject: "CN=stapp",
          certNotAfter: "2020-01-01T00:00:00.000Z",
          estado: "cert_vencido",
          condicionFiscal: "MONOTRIBUTO",
        }}
      />
    )

    expect(screen.getByText(/vencido/i)).toBeInTheDocument()
  })

  /**
   * El punto de venta lo da de alta el contribuyente en ARCA y rara vez es
   * el 1. Emitir contra uno que no existe lo rechaza AFIP.
   */
  it("manda el punto de venta elegido", async () => {
    render(<CredencialesArca allowEdit estadoInicial={ESTADO_VACIO} />)

    subirArchivo("Certificado (.crt)", CERT, "stapp-homo.crt")
    subirArchivo("Clave privada (.key)", KEY, "stapp-homo.key")
    fireEvent.change(screen.getByLabelText(/CUIT/i), { target: { value: "23944498389" } })
    fireEvent.change(screen.getByLabelText(/punto de venta/i), { target: { value: "4" } })

    await waitFor(() => expect(screen.getByRole("button", { name: /conectar/i })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: /conectar/i }))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).puntoVenta).toBe(4)
  })

  it("precarga el punto de venta ya guardado", () => {
    render(
      <CredencialesArca
        allowEdit
        estadoInicial={{
          conectado: true,
          cuit: "23944498389",
          puntoVenta: 7,
          certSubject: null,
          certNotAfter: "2028-08-28T22:56:47.000Z",
          estado: "conectado",
          condicionFiscal: "MONOTRIBUTO",
        }}
      />
    )

    expect(screen.getByLabelText(/punto de venta/i)).toHaveValue(7)
  })
})
