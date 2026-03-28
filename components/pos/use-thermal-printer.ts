"use client"

import { useState, useCallback, useRef, useEffect } from "react"

// WebUSB type declarations (not in default TS lib)
declare global {
  interface Navigator {
    usb: USB
  }
  interface USB {
    getDevices(): Promise<USBDevice[]>
    requestDevice(options: { filters: Array<{ vendorId?: number; productId?: number }> }): Promise<USBDevice>
    addEventListener(type: "connect" | "disconnect", listener: (e: USBConnectionEvent) => void): void
    removeEventListener(type: "connect" | "disconnect", listener: (e: USBConnectionEvent) => void): void
  }
  interface USBConnectionEvent extends Event {
    device: USBDevice
  }
  interface USBDevice {
    vendorId: number
    productId: number
    productName?: string
    configuration: USBConfiguration | null
    open(): Promise<void>
    close(): Promise<void>
    selectConfiguration(configurationValue: number): Promise<void>
    claimInterface(interfaceNumber: number): Promise<void>
    transferOut(endpointNumber: number, data: BufferSource): Promise<USBOutTransferResult>
  }
  interface USBConfiguration {
    interfaces: USBInterface[]
  }
  interface USBInterface {
    interfaceNumber: number
    alternates: USBAlternateInterface[]
  }
  interface USBAlternateInterface {
    endpoints: USBEndpoint[]
  }
  interface USBEndpoint {
    endpointNumber: number
    direction: "in" | "out"
    type: "bulk" | "interrupt" | "isochronous"
  }
  interface USBOutTransferResult {
    bytesWritten: number
    status: "ok" | "stall" | "babble"
  }
}

interface USBDeviceInfo {
  name: string
  vendorId: number
  productId: number
}

interface ThermalPrinterState {
  connected: boolean
  device: USBDeviceInfo | null
  connecting: boolean
  error: string | null
}

/**
 * Hook for managing a thermal printer connection via WebUSB.
 * Provides connect, disconnect, and print functions.
 *
 * WebUSB works in Chrome/Edge only and requires HTTPS (or localhost).
 * The user must grant permission via a browser dialog on first connect.
 */
export function useThermalPrinter() {
  const [state, setState] = useState<ThermalPrinterState>({
    connected: false,
    device: null,
    connecting: false,
    error: null,
  })
  const deviceRef = useRef<USBDevice | null>(null)
  const endpointRef = useRef<number>(0)

  // Check if WebUSB is available
  const isSupported = typeof navigator !== "undefined" && "usb" in navigator

  // Try to reconnect to a previously paired device
  useEffect(() => {
    if (!isSupported) return

    const tryReconnect = async () => {
      try {
        const devices = await navigator.usb.getDevices()
        if (devices.length > 0) {
          const device = devices[0]
          await openDevice(device)
        }
      } catch {
        // Silent fail on auto-reconnect
      }
    }
    tryReconnect()

    // Listen for disconnect
    const handleDisconnect = (e: USBConnectionEvent) => {
      if (deviceRef.current && e.device === deviceRef.current) {
        deviceRef.current = null
        setState({ connected: false, device: null, connecting: false, error: null })
      }
    }
    navigator.usb.addEventListener("disconnect", handleDisconnect)
    return () => navigator.usb.removeEventListener("disconnect", handleDisconnect)
  }, [isSupported])

  const openDevice = async (device: USBDevice) => {
    await device.open()

    // Select configuration (usually config 1)
    if (device.configuration === null) {
      await device.selectConfiguration(1)
    }

    // Find the first interface with a bulk OUT endpoint
    let iface: USBInterface | null = null
    let endpoint = 0

    for (const intf of device.configuration!.interfaces) {
      for (const alt of intf.alternates) {
        for (const ep of alt.endpoints) {
          if (ep.direction === "out" && ep.type === "bulk") {
            iface = intf
            endpoint = ep.endpointNumber
            break
          }
        }
        if (iface) break
      }
      if (iface) break
    }

    if (!iface) {
      throw new Error("No se encontró endpoint de salida en la impresora")
    }

    await device.claimInterface(iface.interfaceNumber)

    deviceRef.current = device
    endpointRef.current = endpoint

    setState({
      connected: true,
      device: {
        name: device.productName || `USB Printer (${device.vendorId.toString(16)})`,
        vendorId: device.vendorId,
        productId: device.productId,
      },
      connecting: false,
      error: null,
    })
  }

  const connect = useCallback(async () => {
    if (!isSupported) {
      setState((s) => ({ ...s, error: "WebUSB no soportado. Use Chrome o Edge." }))
      return
    }

    setState((s) => ({ ...s, connecting: true, error: null }))

    try {
      // Request device - shows browser's USB device picker
      // Filter for common thermal printer vendor IDs
      const device = await navigator.usb.requestDevice({
        filters: [
          // Common thermal printer vendors
          { vendorId: 0x0416 }, // WinBond (many Chinese printers)
          { vendorId: 0x0483 }, // STMicroelectronics (some printers)
          { vendorId: 0x04b8 }, // Epson
          { vendorId: 0x0525 }, // Netchip (Linux USB gadget)
          { vendorId: 0x067b }, // Prolific (USB-Serial adapters)
          { vendorId: 0x1a86 }, // QinHeng (CH340 based)
          { vendorId: 0x1504 }, // POS printers
          { vendorId: 0x0fe6 }, // ICS (various printers)
          { vendorId: 0x0dd4 }, // Custom printers
          { vendorId: 0x20d1 }, // Dario
          { vendorId: 0x0456 }, // Analog Devices
          { vendorId: 0x0493 }, // Star Micronics
          { vendorId: 0x04e8 }, // Samsung (Bixolon)
          { vendorId: 0x0828 }, // Citizen
          { vendorId: 0x2730 }, // Gainscha / Gprinter
        ],
      })

      await openDevice(device)
    } catch (err: any) {
      if (err.name === "NotFoundError") {
        // User cancelled the picker
        setState((s) => ({ ...s, connecting: false }))
        return
      }
      setState({
        connected: false,
        device: null,
        connecting: false,
        error: err.message || "Error al conectar impresora",
      })
    }
  }, [isSupported])

  const disconnect = useCallback(async () => {
    try {
      if (deviceRef.current) {
        await deviceRef.current.close()
      }
    } catch {
      // ignore
    }
    deviceRef.current = null
    setState({ connected: false, device: null, connecting: false, error: null })
  }, [])

  const print = useCallback(async (data: Uint8Array): Promise<boolean> => {
    const device = deviceRef.current
    if (!device || !state.connected) {
      setState((s) => ({ ...s, error: "Impresora no conectada" }))
      return false
    }

    try {
      // Send data in chunks (some printers have buffer limits)
      const CHUNK_SIZE = 64
      for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const chunk = data.slice(i, i + CHUNK_SIZE)
        await device.transferOut(endpointRef.current, chunk)
      }
      return true
    } catch (err: any) {
      console.error("Print error:", err)
      // If transfer fails, device may have disconnected
      if (err.name === "NetworkError" || err.name === "NotFoundError") {
        deviceRef.current = null
        setState({ connected: false, device: null, connecting: false, error: "Impresora desconectada" })
      } else {
        setState((s) => ({ ...s, error: err.message || "Error al imprimir" }))
      }
      return false
    }
  }, [state.connected])

  return {
    ...state,
    isSupported,
    connect,
    disconnect,
    print,
  }
}
