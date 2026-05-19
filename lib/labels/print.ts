/**
 * Client-side output helpers for thermal label spools.
 *
 * Two paths:
 *   1. `downloadLabelFile` — universal: produces a Blob the user can pipe to
 *      their OS spooler (`copy /b file.zpl LPT1`, `lp -d zebra file.zpl`,
 *      or Zebra Setup Utilities). Works in every browser.
 *   2. `tryDirectPrintZebra` — best-effort: uses WebUSB if available
 *      (Chrome/Edge/Opera, HTTPS only, user gesture required). Silently fails
 *      with `{ ok: false }` on Firefox/Safari or if no device is matched.
 */

const ZEBRA_VENDOR_IDS = [
  0x0a5f, // Zebra Technologies
]

/**
 * Triggers a browser download of the given content.
 *
 * Uses Blob URLs so we don't need to base64-encode (which would break on
 * very large jobs). The URL is revoked on the next microtask to free memory.
 */
export function downloadLabelFile(
  content: string,
  filename: string,
  mime: string = "application/octet-stream",
): void {
  if (typeof window === "undefined") return
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Defer revoke so Firefox/Safari finish the download dialog first.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Sends raw ZPL bytes to a Zebra printer over WebUSB.
 *
 * Best-effort flow:
 *   1. Bail silently if `navigator.usb` is undefined.
 *   2. Try to find an already-paired Zebra device first; if none, prompt the
 *      user to pick one (this REQUIRES a user gesture from the calling code).
 *   3. Open, claim interface 0, find the first bulk-out endpoint, write the
 *      ZPL bytes encoded as UTF-8.
 *   4. Always attempt to release/close on the way out.
 *
 * Returns `{ ok: false, error }` on any failure. The caller should display
 * `error` (in Spanish) and offer the download path as fallback.
 */
export async function tryDirectPrintZebra(
  zplContent: string,
): Promise<{ ok: boolean; error?: string }> {
  if (typeof navigator === "undefined" || !(navigator as any).usb) {
    return { ok: false, error: "WebUSB no disponible en este navegador" }
  }

  const usb = (navigator as any).usb as {
    getDevices: () => Promise<any[]>
    requestDevice: (opts: { filters: Array<{ vendorId: number }> }) => Promise<any>
  }

  let device: any = null
  try {
    // Reuse paired device if present — avoids re-prompting.
    const paired = await usb.getDevices()
    device = paired.find((d) => ZEBRA_VENDOR_IDS.includes(d.vendorId)) || null

    if (!device) {
      device = await usb.requestDevice({
        filters: ZEBRA_VENDOR_IDS.map((vendorId) => ({ vendorId })),
      })
    }
    if (!device) {
      return { ok: false, error: "No se seleccionó ninguna impresora Zebra" }
    }

    await device.open()
    if (device.configuration === null) {
      await device.selectConfiguration(1)
    }

    // Pick the first interface and first bulk-out endpoint.
    const iface = device.configuration?.interfaces?.[0]
    if (!iface) {
      return { ok: false, error: "La impresora no expone interfaces USB" }
    }
    const ifaceNumber = iface.interfaceNumber
    await device.claimInterface(ifaceNumber)

    const alt = iface.alternate || iface.alternates?.[0]
    const endpoint = alt?.endpoints?.find(
      (e: any) => e.direction === "out" && e.type === "bulk",
    )
    if (!endpoint) {
      try {
        await device.releaseInterface(ifaceNumber)
      } catch {}
      return { ok: false, error: "Sin endpoint de salida bulk en la impresora" }
    }

    const bytes = new TextEncoder().encode(zplContent)
    await device.transferOut(endpoint.endpointNumber, bytes)

    try {
      await device.releaseInterface(ifaceNumber)
    } catch {}
    try {
      await device.close()
    } catch {}
    return { ok: true }
  } catch (e) {
    // Defensive cleanup on any error path.
    if (device) {
      try {
        await device.close()
      } catch {}
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}
