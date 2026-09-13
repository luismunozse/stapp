/**
 * Tests: configuración de facturación ARCA por DELEGACIÓN.
 *
 * El taller no sube ningún certificado: hace un trámite en Administrador de
 * Relaciones a favor del CUIT de la plataforma y acá solo declara su identidad
 * fiscal. Como ese trámite vive del lado de AFIP, la pantalla tiene que dejar
 * verificarlo — si no, el taller se entera de que no quedó hecho cuando le
 * falla una factura con un cliente esperando.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import React from "react"

import { CredencialesArcaDelegado } from "@/components/configuracion/credenciales-arca-delegado"

const mockFetch = vi.fn()
global.fetch = mockFetch as any

const SIN_CONFIGURAR = {
  conectado: false,
  cuit: null,
  puntoVenta: null,
  condicionFiscal: null,
}

const CONFIGURADO = {
  conectado: true,
  cuit: "30710955057",
  puntoVenta: 3,
  condicionFiscal: "RESPONSABLE_INSCRIPTO" as const,
}

describe("CredencialesArcaDelegado", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ conectado: true }) })
  })

  it("muestra el CUIT de la plataforma al que hay que delegar", () => {
    render(
      <CredencialesArcaDelegado allowEdit cuitPlataforma="23944498389" estadoInicial={SIN_CONFIGURAR} />
    )

    expect(screen.getByText(/23944498389/)).toBeInTheDocument()
  })

  /**
   * Sin el certificado de plataforma no hay a quién delegarle nada. Es un
   * problema de configuración de STApp, no del taller: hay que decirlo así y
   * no dejar guardar una fila que no va a poder emitir.
   */
  it("avisa y bloquea si la plataforma no está configurada", () => {
    render(<CredencialesArcaDelegado allowEdit cuitPlataforma={null} estadoInicial={SIN_CONFIGURAR} />)

    expect(screen.getByText(/no está disponible/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /guardar/i })).toBeDisabled()
  })

  it("guarda en modo delegado con el CUIT normalizado", async () => {
    render(
      <CredencialesArcaDelegado allowEdit cuitPlataforma="23944498389" estadoInicial={SIN_CONFIGURAR} />
    )

    fireEvent.change(screen.getByLabelText(/CUIT del taller/i), { target: { value: "30-71095505-7" } })
    fireEvent.change(screen.getByLabelText(/punto de venta/i), { target: { value: "3" } })

    await waitFor(() => expect(screen.getByRole("button", { name: /guardar/i })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe("/api/facturacion-electronica/credenciales")
    expect(init.method).toBe("PUT")
    expect(JSON.parse(init.body)).toEqual({
      modo: "delegado",
      cuit: "30710955057",
      puntoVenta: 3,
      condicionFiscal: "MONOTRIBUTO",
    })
  })

  it("no deja probar la conexión antes de guardar", () => {
    render(
      <CredencialesArcaDelegado allowEdit cuitPlataforma="23944498389" estadoInicial={SIN_CONFIGURAR} />
    )

    expect(screen.getByRole("button", { name: /probar conexi/i })).toBeDisabled()
  })

  it("al probar muestra los puntos de venta que ARCA reconoce", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, puntosVenta: [{ numero: 3, bloqueado: false }] }),
    })
    render(
      <CredencialesArcaDelegado allowEdit cuitPlataforma="23944498389" estadoInicial={CONFIGURADO} />
    )

    fireEvent.click(screen.getByRole("button", { name: /probar conexi/i }))

    await waitFor(() => {
      expect(screen.getByText(/punto de venta 3/i)).toBeInTheDocument()
    })
    expect(mockFetch.mock.calls[0][0]).toBe("/api/facturacion-electronica/probar")
  })

  /**
   * El caso esperado del primer uso: el taller todavia no hizo el tramite.
   * Tiene que ver el motivo de AFIP, no un "error" generico.
   */
  it("al probar muestra el motivo de ARCA cuando la delegación no está hecha", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: "600: CUIT representada no autorizada" }),
    })
    render(
      <CredencialesArcaDelegado allowEdit cuitPlataforma="23944498389" estadoInicial={CONFIGURADO} />
    )

    fireEvent.click(screen.getByRole("button", { name: /probar conexi/i }))

    await waitFor(() => {
      expect(screen.getByText(/no autorizada/i)).toBeInTheDocument()
    })
  })

  /**
   * 602 del lado del servidor llega como ok:true con lista vacia: la
   * delegacion funciona pero falta dar de alta el punto de venta en ARCA. Son
   * dos problemas distintos y el mensaje tiene que distinguirlos.
   */
  it("distingue delegación OK sin puntos de venta dados de alta", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, puntosVenta: [] }) })
    render(
      <CredencialesArcaDelegado allowEdit cuitPlataforma="23944498389" estadoInicial={CONFIGURADO} />
    )

    fireEvent.click(screen.getByRole("button", { name: /probar conexi/i }))

    await waitFor(() => {
      expect(screen.getByText(/sin puntos de venta/i)).toBeInTheDocument()
    })
  })
})
