import QRCode from "qrcode"

interface LabelData {
  codigoOrden: string
  numeroOrden: number
  clienteNombre: string
  dispositivo: string
  problemaReportado: string
  fechaIngreso: string
  publicToken?: string | null
  organizationName?: string
  /** "ingreso" (default): intake label with reported problem. "reparado": ready-for-pickup tag. */
  variant?: "ingreso" | "reparado"
  /** Repair completion date shown on the "reparado" variant (falls back to fechaIngreso). */
  fechaReparacion?: string
}

/**
 * Opens a print window with a device label sized for label printers.
 * Supports common sizes: 50x30mm, 60x40mm, 70x40mm.
 * Includes QR code for order tracking if publicToken is available.
 *
 * The "reparado" variant prints an internal ready-for-pickup tag to stick on
 * the device once the order reaches REPARADO (badge + repair date instead of
 * the reported problem).
 */
export async function printDeviceLabel(data: LabelData, baseUrl: string) {
  const esReparado = data.variant === "reparado"
  const codigo = data.codigoOrden || `#${data.numeroOrden}`
  const problema = data.problemaReportado.length > 50
    ? data.problemaReportado.substring(0, 50) + "..."
    : data.problemaReportado
  const cliente = data.clienteNombre.length > 25
    ? data.clienteNombre.substring(0, 25) + "..."
    : data.clienteNombre
  const dispositivo = data.dispositivo.length > 28
    ? data.dispositivo.substring(0, 28) + "..."
    : data.dispositivo
  const empresa = data.organizationName || ""
  const fechaPie = esReparado ? (data.fechaReparacion || data.fechaIngreso) : data.fechaIngreso

  // Generate QR code as data URL
  let qrDataUrl = ""
  if (data.publicToken && baseUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(
        `${baseUrl}/seguimiento/${data.publicToken}`,
        { width: 120, margin: 0, errorCorrectionLevel: "M" }
      )
    } catch {
      // QR generation failed, continue without it
    }
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Etiqueta ${esReparado ? "Reparado " : ""}${codigo}</title>
<style>
  @page { size: 60mm 40mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    width: 60mm;
    height: 40mm;
    padding: 2.5mm;
    color: #000;
    display: flex;
    overflow: hidden;
  }
  .left {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-width: 0;
    padding-right: 2mm;
  }
  .right {
    width: 16mm;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .right img {
    width: 15mm;
    height: 15mm;
  }
  .right .scan {
    font-size: 5pt;
    color: #666;
    margin-top: 1mm;
    text-align: center;
  }
  .codigo {
    font-size: 14pt;
    font-weight: bold;
    letter-spacing: 0.5px;
    line-height: 1.1;
    border-bottom: 1px solid #000;
    padding-bottom: 1mm;
    margin-bottom: 1mm;
  }
  .empresa {
    font-size: 6pt;
    color: #555;
    margin-bottom: 0.5mm;
  }
  .info {
    font-size: 7pt;
    line-height: 1.3;
    flex: 1;
  }
  .info .label {
    color: #666;
    font-size: 6pt;
  }
  .info .value {
    font-weight: bold;
  }
  .info div {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badge {
    display: inline-block;
    background: #000;
    color: #fff;
    font-size: 9pt;
    font-weight: bold;
    letter-spacing: 0.5px;
    padding: 0.8mm 2mm;
    margin-bottom: 1mm;
  }
  .listo {
    font-size: 7pt;
    font-weight: bold;
    margin-top: 0.5mm;
  }
  .fecha {
    font-size: 6pt;
    color: #888;
    margin-top: auto;
  }
</style></head><body>
  <div class="left">
    ${empresa ? `<div class="empresa">${empresa}</div>` : ""}
    <div class="codigo">${codigo}</div>
    ${esReparado ? `<span class="badge">✓ REPARADO</span>` : ""}
    <div class="info">
      <div><span class="label">Cliente: </span><span class="value">${cliente}</span></div>
      <div><span class="label">Equipo: </span><span class="value">${dispositivo}</span></div>
      ${esReparado
        ? `<div class="listo">Listo para entregar</div>`
        : `<div><span class="label">Problema: </span>${problema}</div>`}
    </div>
    <div class="fecha">${fechaPie}</div>
  </div>
  ${qrDataUrl ? `
  <div class="right">
    <img src="${qrDataUrl}" alt="QR" />
    <div class="scan">Seguimiento</div>
  </div>
  ` : ""}
<script>window.onload=function(){window.print();}<\/script>
</body></html>`

  const printWindow = window.open("", "_blank", "width=340,height=230")
  if (printWindow) {
    printWindow.document.write(html)
    printWindow.document.close()
  }
}
