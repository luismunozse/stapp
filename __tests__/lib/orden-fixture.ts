/**
 * Shared, fully-populated `generateOrdenPDF` fixture. Used by both the
 * regression coverage in orden-pdf.test.ts and the manual visual-sample
 * generator in pdf-samples.test.ts so there is a single source of truth
 * for "what a real orden PDF's input looks like".
 */
export function buildOrdenFixture() {
  return {
    numeroOrden: 1042,
    fechaIngreso: new Date(),
    fechaPrometida: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    cliente: {
      nombre: "Juan Pérez",
      telefono: "+54 9 11 2345-6789",
      email: "juan.perez@example.com",
      direccion: "Av. Corrientes 1234, CABA",
      dni: "28.456.789",
      cuit: null,
      razonSocial: null,
      tipoCliente: "INDIVIDUAL",
    },
    dispositivo: "iPhone 13",
    tipoDispositivo: "CELULAR",
    marca: "Apple",
    color: "Negro",
    imei: "358400123456789",
    problemaReportado:
      "El equipo no enciende desde que se mojó levemente con la lluvia. Además, la pantalla parpadea de forma intermitente cada vez que se intenta reiniciarlo.",
    accesorios: "Cargador, funda, chip claro",
    codigoAccesoDispositivo: "Patrón: 1-2-5-8-9",
    presupuesto: 45000,
    sena: 10000,
    metodoPagoSena: "EFECTIVO",
    observaciones: "El cliente solicita que se lo contacte únicamente por WhatsApp.",
    nombreEmpresa: "Servicio Técnico Demo",
    telefonoEmpresa: "+54 11 4000-1234",
    direccionEmpresa: "Av. Rivadavia 5000, CABA",
    // ciudad/provincia (Item 3 header redesign): distinct from any other
    // address string in this fixture on purpose, so a header assertion for
    // "Rosario, Santa Fe" can't accidentally pass off a match elsewhere
    // (both cliente.direccion and direccionEmpresa above already contain
    // "CABA", which would make that a weak choice here).
    ciudadEmpresa: "Rosario",
    provinciaEmpresa: "Santa Fe",
    moneda: "ARS",
    zonaHoraria: "America/Argentina/Buenos_Aires",
    estado: "RECIBIDO",
    publicToken: "sample-public-token-1234",
    baseUrl: "https://demo.stapp.com.ar",
    // categoria (Task D5): agrupa el panel "Chequeo de recepción" de la hoja
    // ENTREGA (lib/pdf.ts ~L1465) en FUNCIONAL/CONDICION_FISICA/ACCESORIOS en
    // vez de caer todo en el bucket GENERAL — D4 rasterizó esta hoja sin
    // categoria puesta (ver task-D4-report.md, "Fotos-count decision" vicino),
    // así que el agrupado por categoría nunca se vio dibujado hasta ahora.
    // La hoja RECEPCIÓN (talón "Chequeo rápido") ignora `categoria` por
    // completo — agregarla acá no cambia nada de lo que esa hoja ya dibuja.
    checklistItems: [
      { label: "Pantalla táctil funciona", valor: true, categoria: "FUNCIONAL" },
      { label: "Botón de encendido funciona", valor: true, categoria: "FUNCIONAL" },
      { label: "Cámara trasera funciona", valor: false, categoria: "FUNCIONAL" },
      { label: "Puerto de carga funciona", valor: false, categoria: "FUNCIONAL" },
      { label: "Estado de la carcasa", valor: "Rayones leves en el borde superior", categoria: "CONDICION_FISICA" },
      { label: "Accesorios entregados por el cliente", valor: "Cargador original, funda transparente", categoria: "ACCESORIOS" },
    ],
    checklistNotas: "El cliente indica que el equipo se reinicia solo al usar la cámara.",
    // Campos del expediente (Task D2) — ejercitan los bloques nuevos de la
    // hoja RECEPCIÓN (Task D3): código de orden, sucursal, timeline, técnico,
    // quién recibió, teléfono de contacto de esta orden y metadata flotante.
    codigoOrden: "CEL-1042",
    sucursal: { nombre: "Sucursal Centro", direccion: "Av. Rivadavia 5000, CABA", telefono: "+54 11 4000-1234" },
    tecnicoNombre: "L. Ferreyra",
    recibidoPorNombre: "M. Gómez",
    telefonoContacto: "+54 9 11 9988-7766",
    metadataCampos: [{ label: "Batería", valor: "78%" }],
    timeline: [{ estado: "RECIBIDO", fecha: new Date() }],
    // No se dibujan en la hoja RECEPCIÓN (D4 los usa para ENTREGA) — presentes
    // acá solo para confirmar que generateOrdenPDF los ignora sin romperse.
    trabajos: [{ nombre: "Batería iPhone 13", cantidad: 1, importe: 48000 }],
    garantia: { dias: 90, fechaVencimiento: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), notas: null },
    cobros: [{ fecha: new Date(), metodo: "EFECTIVO", referencia: null, monto: 10000 }],
  }
}

/**
 * Worst-case content fixture (fix: orden-a4-fijo review, Important #2/#3):
 * every wrapped/capped field pushed long enough to hit its existing slice
 * cap (falla declarada 3 lines, observaciones 2 lines, talón "chequeo
 * rápido" 4 lines, términos 6 lines, ...). Used to check that the
 * bottom-anchored RECEPCIÓN talón and the bottom-anchored ENTREGA footer
 * still land at/near the bottom margin instead of drifting off-page when
 * the MIN_GAP floor (not the normal leftover-space distribution) is what
 * ends up driving the layout.
 */
const LOREM =
  "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat."

export function buildMaxContentOrdenFixture() {
  return {
    ...buildOrdenFixture(),
    problemaReportado: LOREM,
    observaciones: LOREM,
    accesorios: LOREM,
    checklistItems: Array.from({ length: 10 }, (_, i) => ({
      label: `Chequeo de mostrador número ${i + 1} con descripción larga para forzar el wrap`,
      valor: i % 2 === 0,
      categoria: "FUNCIONAL",
    })),
    checklistNotas: LOREM,
    recepcionTerminos: Array.from({ length: 10 }, (_, i) => `${i + 1}. ${LOREM}`).join("\n"),
  }
}
