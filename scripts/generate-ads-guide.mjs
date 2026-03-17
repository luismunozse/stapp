import { jsPDF } from "jspdf"
import fs from "fs"
import path from "path"

const doc = new jsPDF()
const pageWidth = doc.internal.pageSize.getWidth()
const margin = 20
const maxWidth = pageWidth - margin * 2
let y = 20

function title(text) {
  doc.setFont("helvetica", "bold")
  doc.setFontSize(22)
  doc.setTextColor(30, 64, 175)
  doc.text(text, pageWidth / 2, y, { align: "center" })
  y += 12
}

function subtitle(text) {
  doc.setFont("helvetica", "bold")
  doc.setFontSize(10)
  doc.setTextColor(100, 100, 100)
  doc.text(text, pageWidth / 2, y, { align: "center" })
  y += 14
}

function heading(text) {
  checkPage(16)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(14)
  doc.setTextColor(30, 64, 175)
  doc.text(text, margin, y)
  y += 3
  doc.setDrawColor(30, 64, 175)
  doc.setLineWidth(0.5)
  doc.line(margin, y, pageWidth - margin, y)
  y += 8
}

function subheading(text) {
  checkPage(12)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(11)
  doc.setTextColor(50, 50, 50)
  doc.text(text, margin, y)
  y += 7
}

function paragraph(text) {
  checkPage(10)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.setTextColor(50, 50, 50)
  const lines = doc.splitTextToSize(text, maxWidth)
  doc.text(lines, margin, y)
  y += lines.length * 5 + 3
}

function bullet(text) {
  checkPage(10)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.setTextColor(50, 50, 50)
  const lines = doc.splitTextToSize(text, maxWidth - 8)
  doc.text("•", margin + 2, y)
  doc.text(lines, margin + 8, y)
  y += lines.length * 5 + 2
}

function numberedItem(num, text) {
  checkPage(10)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(10)
  doc.setTextColor(30, 64, 175)
  doc.text(`${num}.`, margin + 2, y)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(50, 50, 50)
  const lines = doc.splitTextToSize(text, maxWidth - 12)
  doc.text(lines, margin + 12, y)
  y += lines.length * 5 + 3
}

function code(text) {
  checkPage(14)
  doc.setFillColor(245, 245, 245)
  const lines = doc.splitTextToSize(text, maxWidth - 10)
  const blockHeight = lines.length * 5 + 6
  doc.roundedRect(margin, y - 4, maxWidth, blockHeight, 2, 2, "F")
  doc.setFont("courier", "normal")
  doc.setFontSize(9)
  doc.setTextColor(180, 50, 50)
  doc.text(lines, margin + 5, y + 1)
  y += blockHeight + 4
}

function spacer(size = 6) {
  y += size
}

function checkPage(needed = 20) {
  if (y + needed > doc.internal.pageSize.getHeight() - 20) {
    doc.addPage()
    y = 20
  }
}

function tip(text) {
  checkPage(18)
  doc.setFillColor(254, 243, 199)
  const lines = doc.splitTextToSize(text, maxWidth - 16)
  const blockHeight = lines.length * 5 + 8
  doc.roundedRect(margin, y - 4, maxWidth, blockHeight, 2, 2, "F")
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.setTextColor(146, 64, 14)
  doc.text("TIP:", margin + 5, y + 1)
  doc.setFont("helvetica", "normal")
  doc.text(lines, margin + 5, y + 7)
  y += blockHeight + 4
}

// =============================================
// CONTENIDO DEL PDF
// =============================================

title("STApp - Google Ads")
subtitle("Guia de configuracion e implementacion")
spacer(4)
paragraph("Fecha: Marzo 2026 | Sitio: https://stapp.com.ar")
spacer(6)

// --- SECCION 1 ---
heading("1. Crear cuenta de Google Ads")
numberedItem(1, "Ingresa a ads.google.com y crea una cuenta con tu email de Google.")
numberedItem(2, "Selecciona tu pais (Argentina) y zona horaria (Buenos Aires, GMT-3).")
numberedItem(3, "Configura tu metodo de pago (tarjeta de credito/debito).")
numberedItem(4, "Selecciona la moneda: ARS (Peso argentino) o USD.")
tip("Si planeas expandir a LATAM mas adelante, considera usar USD como moneda de la cuenta.")
spacer(4)

// --- SECCION 2 ---
heading("2. Configurar conversion tracking")
paragraph("El conversion tracking permite medir cuantos registros genera cada anuncio. Ya esta implementado en el codigo de STApp.")
spacer(2)
subheading("Paso 2.1 - Crear la accion de conversion")
numberedItem(1, "En Google Ads, ve a Herramientas > Medicion > Conversiones.")
numberedItem(2, 'Click en "+ Nueva accion de conversion".')
numberedItem(3, 'Selecciona "Sitio web".')
numberedItem(4, "Ingresa tu dominio: stapp.com.ar")
numberedItem(5, 'Configura manualmente la conversion con estos datos:')
spacer(2)
bullet('Nombre: "Registro STApp"')
bullet('Categoria: "Registro / Sign-up"')
bullet("Valor: Usa un valor fijo de $19,999 ARS (valor mensual del plan)")
bullet('Recuento: "Una" (una conversion por usuario)')
bullet("Ventana de conversion: 30 dias (click), 7 dias (vista)")
bullet('Modelo de atribucion: "Basada en datos" o "Ultimo click"')
spacer(2)

subheading("Paso 2.2 - Obtener los IDs")
paragraph("Despues de crear la conversion, Google Ads te mostrara un snippet. De ahi necesitas extraer:")
spacer(2)
bullet("Google Ads ID: tiene formato AW-XXXXXXXXXX (ej: AW-123456789)")
bullet("Conversion Label: tiene formato AW-XXXXXXXXXX/XXXXXXXXXXX")
spacer(4)

// --- SECCION 3 ---
heading("3. Variables de entorno")
paragraph("Agrega estas variables en tu archivo .env y en Vercel (Settings > Environment Variables):")
spacer(2)
code("NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX\nNEXT_PUBLIC_GOOGLE_ADS_ID=AW-XXXXXXXXXX\nNEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID=AW-XXXXXXXXXX/XXXXXXXXXXX")
spacer(2)
paragraph("Reemplaza los valores con los IDs reales obtenidos en el paso anterior.")
tip("El GA_MEASUREMENT_ID es de Google Analytics 4 (GA4). Si aun no lo tenes, crealo en analytics.google.com vinculandolo con tu cuenta de Google Ads.")
spacer(4)

// --- SECCION 4 ---
heading("4. Verificar la implementacion")
paragraph("El tracking ya esta integrado en el codigo del proyecto:")
spacer(2)
bullet("lib/gtag.ts - Funciones trackAdsConversion() y trackEvent()")
bullet("app/(auth)/registro/page.tsx - Dispara la conversion al registrarse exitosamente")
bullet("components/seo/google-analytics.tsx - Carga el script de gtag con soporte para Ads")
spacer(2)
paragraph("Para verificar que funciona correctamente:")
spacer(2)
numberedItem(1, 'Instala la extension "Google Tag Assistant" en Chrome.')
numberedItem(2, "Visita stapp.com.ar/registro y completa un registro de prueba.")
numberedItem(3, "Verifica que el evento de conversion aparezca en Tag Assistant.")
numberedItem(4, "En Google Ads > Conversiones, deberia aparecer como 'Sin verificar' hasta que se registre la primera conversion real.")
tip("Google Ads puede tardar hasta 24-48 horas en verificar y mostrar las conversiones.")
spacer(4)

// --- SECCION 5 ---
heading("5. Estructura de campanas recomendada")
spacer(2)
subheading("Campana 1: Search - Intencion alta")
paragraph("Objetivo: Captar personas buscando activamente software para talleres de reparacion.")
spacer(2)
bullet("Keywords: software para servicio tecnico, software para taller de reparacion, sistema de ordenes de trabajo, programa para gestionar reparaciones, software reparacion celulares")
spacer(2)
paragraph('Anuncio sugerido:')
code("Titulo: STApp - Software para Talleres de Reparacion\nDescripcion: Ordenes, clientes, inventario y cobros en un solo lugar.\nProba gratis 30 dias. Sin tarjeta de credito.\nURL: stapp.com.ar")
spacer(4)

subheading("Campana 2: Search - Dolor especifico")
paragraph("Objetivo: Captar personas con problemas concretos que STApp resuelve.")
spacer(2)
bullet("Keywords: como organizar un taller de reparacion, control de inventario repuestos, sistema de cobros para taller, notificar clientes reparacion WhatsApp")
spacer(2)
paragraph('Anuncio sugerido:')
code("Titulo: Perdes reparaciones en papeles?\nDescripcion: STApp organiza tu taller: ordenes, stock, cobros y WhatsApp.\nDesde $700/dia. Proba 30 dias gratis.\nURL: stapp.com.ar")
spacer(4)

subheading("Campana 3: Search - Emprendedores")
paragraph("Objetivo: Captar personas que estan abriendo un taller nuevo.")
spacer(2)
bullet("Keywords: como abrir un taller de celulares, que necesito para un servicio tecnico, como empezar negocio reparacion celulares")
spacer(2)
paragraph('Anuncio sugerido:')
code("Titulo: Arrancas tu taller de reparacion?\nDescripcion: Empeza organizado desde el dia 1 con STApp.\nOrdenes, clientes, inventario y reportes. Proba gratis.\nURL: stapp.com.ar")
spacer(4)

// --- SECCION 6 ---
heading("6. Configuracion recomendada")
spacer(2)
bullet("Ubicacion: Argentina (expandir a Mexico, Colombia, Chile despues)")
bullet("Idioma: Espanol")
bullet("Estrategia de puja: Maximizar conversiones (cambiar a CPA objetivo tras 30 conversiones)")
bullet("Presupuesto inicial: $5-10 USD/dia para testear")
bullet("Conversion a trackear: Registro completado")
spacer(4)

subheading("Extensiones de anuncio")
paragraph("Sitelinks:")
bullet("Funcionalidades -> /empresa/sobre-nosotros")
bullet("Casos de uso -> /casos-de-uso")
bullet("Blog -> /empresa/blog")
bullet("Contacto -> /empresa/contacto")
spacer(2)
paragraph("Callouts:")
bullet("30 dias gratis | Sin tarjeta de credito | Tecnicos ilimitados | Notificaciones WhatsApp | Soporte prioritario")
spacer(4)

// --- SECCION 7 ---
heading("7. Keywords negativas")
paragraph("Agregar desde el inicio para evitar clicks irrelevantes:")
spacer(2)
code("gratis, descargar, crack, pirata, curso, empleo,\ntrabajo, sueldo, samsung, iphone, cerca de mi,\nservicio tecnico cerca")
spacer(4)

// --- SECCION 8 ---
heading("8. Metricas clave a monitorear")
spacer(2)
bullet("CTR > 5% en Search - Si es menor, mejorar los anuncios")
bullet("Costo por registro < $3-5 USD")
bullet("Tasa de conversion en landing > 10%")
bullet("Quality Score > 7 en keywords principales")
spacer(4)

// --- SECCION 9 ---
heading("9. Checklist final")
spacer(2)
numberedItem(1, "Cuenta de Google Ads creada")
numberedItem(2, "Conversion 'Registro STApp' configurada")
numberedItem(3, "Variables de entorno configuradas en Vercel")
numberedItem(4, "Google Analytics 4 vinculado con Google Ads")
numberedItem(5, "Tag Assistant verificado en registro de prueba")
numberedItem(6, "Campanas creadas con keywords y anuncios")
numberedItem(7, "Keywords negativas agregadas")
numberedItem(8, "Extensiones de anuncio configuradas")
numberedItem(9, "Presupuesto diario definido")

// GUARDAR
const outputPath = path.resolve("STApp_Google_Ads_Guia.pdf")
const buffer = Buffer.from(doc.output("arraybuffer"))
fs.writeFileSync(outputPath, buffer)
console.log(`PDF generado: ${outputPath}`)
