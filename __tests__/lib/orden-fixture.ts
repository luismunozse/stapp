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
    cliente: {
      nombre: "Juan Pérez",
      telefono: "+54 9 11 2345-6789",
      email: "juan.perez@example.com",
      direccion: "Av. Corrientes 1234, CABA",
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
    moneda: "ARS",
    zonaHoraria: "America/Argentina/Buenos_Aires",
    estado: "RECIBIDO",
    publicToken: "sample-public-token-1234",
    baseUrl: "https://demo.stapp.com.ar",
    checklistItems: [
      { label: "Pantalla táctil funciona", valor: true },
      { label: "Botón de encendido funciona", valor: true },
      { label: "Cámara trasera funciona", valor: false },
      { label: "Puerto de carga funciona", valor: false },
      { label: "Estado de la carcasa", valor: "Rayones leves en el borde superior" },
      { label: "Accesorios entregados por el cliente", valor: "Cargador original, funda transparente" },
    ],
    checklistNotas: "El cliente indica que el equipo se reinicia solo al usar la cámara.",
  }
}
