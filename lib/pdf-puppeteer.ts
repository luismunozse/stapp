import puppeteer from "puppeteer-core"
import chromium from "@sparticuz/chromium-min"

// URL del binario de Chromium compatible con chromium-min v131
const CHROMIUM_BINARY_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar"

// ========================================
// TIPOS
// ========================================
export interface OrdenPDFData {
  numeroOrden: number
  fechaIngreso: Date
  fechaPrometida?: Date | null
  cliente: {
    nombre: string
    telefono: string
    email?: string | null
    direccion?: string | null
  }
  dispositivo: string
  tipoDispositivo: string
  marca?: string | null
  color?: string | null
  imei?: string | null
  problemaReportado: string
  accesorios?: string | null
  passwordDispositivo?: string | null
  presupuesto?: number | null
  observaciones?: string | null
  nombreEmpresa?: string
  telefonoEmpresa?: string
  direccionEmpresa?: string
  logoUrl?: string | null
}

// ========================================
// HELPERS
// ========================================
const formatDate = (date: Date): string => {
  return date.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(amount)
}

const tipoDispositivoLabels: Record<string, string> = {
  CELULAR: "Celular",
  COMPUTADORA: "Computadora",
  TABLET: "Tablet",
  CONSOLA: "Consola",
  OTRO: "Otro",
}

const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

// Detectar si es patrón o PIN
const isPatternLock = (value: string): boolean => {
  return value.startsWith("Patrón: ")
}

// Parsear el patrón
const parsePattern = (value: string): number[] => {
  if (!value || !value.startsWith("Patrón: ")) return []
  const patternStr = value.replace("Patrón: ", "")
  return patternStr.split("-").map(Number).filter(n => n >= 1 && n <= 9)
}

// Generar SVG del patrón
const generatePatternSVG = (patternValue: string): string => {
  const pattern = parsePattern(patternValue)
  if (pattern.length === 0) return ""

  const size = 60
  const padding = 10
  const spacing = (size - 2 * padding) / 2

  // Calcular posición de cada punto (1-9)
  const getPos = (num: number) => {
    const index = num - 1
    const row = Math.floor(index / 3)
    const col = index % 3
    return {
      x: padding + col * spacing,
      y: padding + row * spacing,
    }
  }

  // Generar líneas del patrón
  let pathD = ""
  if (pattern.length > 0) {
    const first = getPos(pattern[0])
    pathD = `M ${first.x} ${first.y}`
    for (let i = 1; i < pattern.length; i++) {
      const pos = getPos(pattern[i])
      pathD += ` L ${pos.x} ${pos.y}`
    }
  }

  // Generar los 9 puntos
  let dots = ""
  for (let i = 1; i <= 9; i++) {
    const pos = getPos(i)
    const isSelected = pattern.includes(i)
    dots += `
      <circle cx="${pos.x}" cy="${pos.y}" r="5" fill="${isSelected ? '#6366f1' : '#e2e8f0'}" />
      <circle cx="${pos.x}" cy="${pos.y}" r="2" fill="${isSelected ? '#4f46e5' : '#9ca3af'}" />
    `
  }

  return `
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0;">
      <path d="${pathD}" stroke="#6366f1" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      ${dots}
    </svg>
  `
}

// ========================================
// PLANTILLA HTML
// ========================================
export const generateOrdenHTML = (data: OrdenPDFData): string => {
  const logoSection = data.logoUrl
    ? `<img src="${data.logoUrl}" alt="Logo" class="logo" />`
    : `<div class="logo-placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5m-4 0h4"/>
        </svg>
      </div>`

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Orden de Servicio #${data.numeroOrden}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 12px;
      line-height: 1.4;
      color: #1e293b;
      background: #ffffff;
    }
    .page { width: 210mm; height: 297mm; padding: 0; background: white; overflow: hidden; }
    .accent-bar { height: 6px; background: linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%); }
    .container { padding: 20px 28px; }

    /* Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 2px solid #f1f5f9;
    }
    .header-left { display: flex; align-items: center; gap: 12px; }
    .logo { width: 50px; height: 50px; object-fit: contain; border-radius: 10px; }
    .logo-placeholder {
      width: 50px; height: 50px;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      color: white;
    }
    .logo-placeholder svg { width: 26px; height: 26px; }
    .company-info h1 { font-size: 16px; font-weight: 700; color: #1e1b4b; margin-bottom: 2px; }
    .company-info p { font-size: 10px; color: #64748b; margin-bottom: 1px; }
    .header-right { text-align: right; }
    .doc-badge {
      display: inline-block;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      color: white;
      padding: 5px 14px;
      border-radius: 6px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 6px;
    }
    .order-number { font-size: 20px; font-weight: 700; color: #1e1b4b; }
    .order-number span { color: #6366f1; }
    .order-dates { margin-top: 4px; font-size: 10px; color: #64748b; }
    .order-dates strong { color: #1e293b; }

    /* Titulo */
    .main-title { text-align: center; margin-bottom: 14px; }
    .main-title h2 {
      font-size: 13px; font-weight: 600; color: #1e1b4b;
      text-transform: uppercase; letter-spacing: 2px;
      position: relative; display: inline-block;
    }
    .main-title h2::before, .main-title h2::after {
      content: ''; position: absolute; top: 50%; width: 30px; height: 2px;
      background: linear-gradient(90deg, #6366f1, transparent);
    }
    .main-title h2::before { right: 100%; margin-right: 10px; background: linear-gradient(90deg, transparent, #6366f1); }
    .main-title h2::after { left: 100%; margin-left: 10px; }

    /* Grid */
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }

    /* Cards */
    .card { background: #f8fafc; border-radius: 8px; padding: 12px; border: 1px solid #e2e8f0; }
    .card-title {
      font-size: 9px; font-weight: 600; color: #6366f1;
      text-transform: uppercase; letter-spacing: 1px;
      margin-bottom: 8px; display: flex; align-items: center; gap: 6px;
    }
    .card-title::before {
      content: ''; width: 3px; height: 12px;
      background: linear-gradient(180deg, #6366f1, #8b5cf6); border-radius: 2px;
    }
    .card-row { display: flex; margin-bottom: 5px; }
    .card-row:last-child { margin-bottom: 0; }
    .card-label { width: 80px; font-size: 10px; color: #64748b; flex-shrink: 0; }
    .card-value { font-size: 11px; color: #1e293b; font-weight: 500; }

    /* Sections */
    .section { background: #f8fafc; border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; border: 1px solid #e2e8f0; }
    .section-title {
      font-size: 9px; font-weight: 600; color: #6366f1;
      text-transform: uppercase; letter-spacing: 1px;
      margin-bottom: 6px; display: flex; align-items: center; gap: 6px;
    }
    .section-title::before {
      content: ''; width: 3px; height: 12px;
      background: linear-gradient(180deg, #6366f1, #8b5cf6); border-radius: 2px;
    }
    .section-content { font-size: 11px; color: #374151; line-height: 1.5; white-space: pre-wrap; }

    /* Info boxes */
    .info-boxes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; }
    .info-box { background: white; border: 2px solid #e2e8f0; border-radius: 8px; padding: 10px; text-align: center; }
    .info-box.highlight { border-color: #6366f1; background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%); }
    .info-box.pattern-box { padding: 8px; }
    .info-box-label { font-size: 8px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
    .info-box-value { font-size: 11px; font-weight: 600; color: #1e293b; }
    .info-box.highlight .info-box-value { color: #6366f1; }
    .pattern-display { display: flex; justify-content: center; margin-top: 4px; }

    /* Firmas */
    .signatures {
      display: grid; grid-template-columns: 1fr 1fr; gap: 30px;
      margin-top: 16px; padding-top: 16px; border-top: 2px dashed #e2e8f0;
    }
    .signature-box { text-align: center; }
    .signature-line { border-top: 2px solid #1e293b; margin-bottom: 6px; margin-top: 30px; }
    .signature-label { font-size: 10px; color: #64748b; font-weight: 500; }

    /* Footer - Términos */
    .footer { margin-top: 14px; padding-top: 10px; border-top: 1px solid #e2e8f0; }
    .footer-title { font-size: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; color: #6366f1; }
    .footer-text { font-size: 8px; line-height: 1.5; color: #64748b; }
    .footer-item { margin-bottom: 2px; padding-left: 10px; position: relative; }
    .footer-item::before { content: '•'; color: #6366f1; position: absolute; left: 0; }

    /* Bottom bar */
    .bottom-bar { height: 6px; background: linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%); margin-top: 14px; border-radius: 3px; }

    @media print {
      body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .page { margin: 0; padding: 0; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="accent-bar"></div>

    <div class="container">
      <!-- Header -->
      <header class="header">
        <div class="header-left">
          ${logoSection}
          <div class="company-info">
            <h1>${escapeHtml(data.nombreEmpresa || "Servicio Técnico")}</h1>
            ${data.telefonoEmpresa ? `<p>${escapeHtml(data.telefonoEmpresa)}</p>` : ""}
            ${data.direccionEmpresa ? `<p>${escapeHtml(data.direccionEmpresa)}</p>` : ""}
          </div>
        </div>

        <div class="header-right">
          <div class="doc-badge">Recepción</div>
          <div class="order-number">#<span>${data.numeroOrden}</span></div>
          <div class="order-dates">
            <strong>Ingreso:</strong> ${formatDate(data.fechaIngreso)}
            ${data.fechaPrometida ? `<br><strong>Entrega:</strong> ${formatDate(data.fechaPrometida)}` : ""}
          </div>
        </div>
      </header>

      <!-- Título -->
      <div class="main-title">
        <h2>Comprobante de Recepción</h2>
      </div>

      <!-- Grid Cliente y Dispositivo -->
      <div class="grid-2">
        <div class="card">
          <div class="card-title">Datos del Cliente</div>
          <div class="card-row">
            <span class="card-label">Nombre</span>
            <span class="card-value">${escapeHtml(data.cliente.nombre)}</span>
          </div>
          <div class="card-row">
            <span class="card-label">Teléfono</span>
            <span class="card-value">${escapeHtml(data.cliente.telefono)}</span>
          </div>
          ${data.cliente.email ? `
          <div class="card-row">
            <span class="card-label">Email</span>
            <span class="card-value">${escapeHtml(data.cliente.email)}</span>
          </div>
          ` : ""}
          ${data.cliente.direccion ? `
          <div class="card-row">
            <span class="card-label">Dirección</span>
            <span class="card-value">${escapeHtml(data.cliente.direccion)}</span>
          </div>
          ` : ""}
        </div>

        <div class="card">
          <div class="card-title">Dispositivo</div>
          <div class="card-row">
            <span class="card-label">Tipo</span>
            <span class="card-value">${tipoDispositivoLabels[data.tipoDispositivo] || data.tipoDispositivo}</span>
          </div>
          <div class="card-row">
            <span class="card-label">Equipo</span>
            <span class="card-value">${escapeHtml(data.dispositivo)}</span>
          </div>
          ${data.marca ? `
          <div class="card-row">
            <span class="card-label">Marca</span>
            <span class="card-value">${escapeHtml(data.marca)}</span>
          </div>
          ` : ""}
          ${data.color ? `
          <div class="card-row">
            <span class="card-label">Color</span>
            <span class="card-value">${escapeHtml(data.color)}</span>
          </div>
          ` : ""}
          ${data.imei ? `
          <div class="card-row">
            <span class="card-label">IMEI/Serie</span>
            <span class="card-value">${escapeHtml(data.imei)}</span>
          </div>
          ` : ""}
        </div>
      </div>

      <!-- Info boxes -->
      <div class="info-boxes">
        ${data.accesorios ? `
        <div class="info-box">
          <div class="info-box-label">Accesorios</div>
          <div class="info-box-value">${escapeHtml(data.accesorios)}</div>
        </div>
        ` : ""}
        ${data.passwordDispositivo ? `
        <div class="info-box ${isPatternLock(data.passwordDispositivo) ? 'pattern-box' : ''}">
          <div class="info-box-label">${isPatternLock(data.passwordDispositivo) ? 'Patrón' : 'PIN/Contraseña'}</div>
          ${isPatternLock(data.passwordDispositivo)
            ? `<div class="pattern-display">${generatePatternSVG(data.passwordDispositivo)}</div>`
            : `<div class="info-box-value">${escapeHtml(data.passwordDispositivo)}</div>`
          }
        </div>
        ` : ""}
        ${data.presupuesto ? `
        <div class="info-box highlight">
          <div class="info-box-label">Presupuesto Estimado</div>
          <div class="info-box-value">${formatCurrency(data.presupuesto)}</div>
        </div>
        ` : ""}
      </div>

      <!-- Problema Reportado -->
      <div class="section">
        <div class="section-title">Problema Reportado</div>
        <div class="section-content">${escapeHtml(data.problemaReportado)}</div>
      </div>

      <!-- Observaciones -->
      ${data.observaciones ? `
      <div class="section">
        <div class="section-title">Observaciones</div>
        <div class="section-content">${escapeHtml(data.observaciones)}</div>
      </div>
      ` : ""}

      <!-- Firmas -->
      <div class="signatures">
        <div class="signature-box">
          <div class="signature-line"></div>
          <div class="signature-label">Firma del Cliente</div>
        </div>
        <div class="signature-box">
          <div class="signature-line"></div>
          <div class="signature-label">Firma del Técnico</div>
        </div>
      </div>

      <!-- Footer -->
      <div class="footer">
        <div class="footer-title">Términos y Condiciones</div>
        <div class="footer-text">
          <div class="footer-item">El plazo de reparación está sujeto a disponibilidad de repuestos.</div>
          <div class="footer-item">Los equipos no retirados en 90 días serán considerados en abandono.</div>
          <div class="footer-item">No nos hacemos responsables por datos almacenados en el dispositivo.</div>
          <div class="footer-item">El presupuesto puede variar según el diagnóstico técnico.</div>
        </div>
      </div>

      <div class="bottom-bar"></div>
    </div>
  </div>
</body>
</html>
`
}

// ========================================
// GENERADOR DE PDF CON PUPPETEER
// ========================================

// Detectar si estamos en Vercel/producción
const isVercel = process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME

// Función para obtener el path de Chrome en desarrollo local (Windows/Mac/Linux)
async function getLocalChromePath(): Promise<string | undefined> {
  const possiblePaths = [
    // Windows
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
    // Mac
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    // Linux
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ]

  for (const path of possiblePaths) {
    if (path) {
      try {
        const fs = await import("fs")
        if (fs.existsSync(path)) {
          return path
        }
      } catch {
        continue
      }
    }
  }
  return undefined
}

export async function generateOrdenPDFPuppeteer(
  data: OrdenPDFData
): Promise<Buffer> {
  let browser

  if (isVercel) {
    // Producción: usar @sparticuz/chromium-min con binario remoto
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1280, height: 720 },
      executablePath: await chromium.executablePath(CHROMIUM_BINARY_URL),
      headless: true,
    })
  } else {
    // Desarrollo local: usar Chrome instalado
    const executablePath = await getLocalChromePath()
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    })
  }

  try {
    const page = await browser.newPage()

    // Generar HTML
    const html = generateOrdenHTML(data)

    // Cargar el HTML
    await page.setContent(html, {
      waitUntil: "networkidle0",
    })

    // Generar PDF
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "0",
        right: "0",
        bottom: "0",
        left: "0",
      },
    })

    return Buffer.from(pdfBuffer)
  } finally {
    await browser.close()
  }
}
