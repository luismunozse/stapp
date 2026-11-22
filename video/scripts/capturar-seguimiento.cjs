// Captura la pantalla pública de seguimiento real (app corriendo en local)
// con una orden ficticia: las respuestas de /api/public/ordenes/* se simulan.
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.resolve(__dirname, '../public/screens');
const BASE = process.env.BASE || 'http://localhost:3000';
const TOKEN = 'demo-token-123';
const d = (day, h) => `2026-11-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00-03:00`;
const orden = (estado) => ({
  id: 'demo', numeroOrden: 128, codigoOrden: 'CEL128', dispositivo: 'Galaxy A54', tipoDispositivo: 'CELULAR',
  tipoDispositivoNombre: 'Celular', marca: 'Samsung', color: 'Negro', estado,
  problemaReportado: 'Pantalla rota, no responde el táctil', diagnostico: estado === 'RECIBIDO' ? null : 'Cambio de módulo de pantalla',
  accesorios: 'Funda', fechaIngreso: d(18, 10), fechaPrometida: d(21, 18), fechaCompletado: estado === 'REPARADO' ? d(20, 16) : undefined,
  publicToken: TOKEN, zonaHoraria: 'America/Argentina/Buenos_Aires', presupuesto: estado === 'RECIBIDO' ? undefined : 45000, moneda: 'ARS',
  presupuestoAprobadoPortal: estado !== 'RECIBIDO' && estado !== 'EN_DIAGNOSTICO', cotizaciones: [],
  cliente: { nombre: 'Lucía Fernández' },
  organizacion: { nombre: 'Taller Demo', telefono: '1155550100', direccion: 'Av. Siempreviva 742' },
  pago: null,
});
const flujo = ['RECIBIDO', 'EN_DIAGNOSTICO', 'APROBADO', 'EN_REPARACION', 'REPARADO'];
const timeline = (estado) => flujo.slice(0, flujo.indexOf(estado) + 1).map((e, i) => ({
  id: 'ev' + i, type: 'evento', eventType: 'CAMBIO_ESTADO', estadoNuevo: e, createdAt: d(18 + Math.floor(i / 2), 10 + i * 2),
}));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const estado of ['RECIBIDO', 'EN_REPARACION', 'REPARADO']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: 'light', locale: 'es-AR' });
    const p = await ctx.newPage();
    await p.route('**/api/public/ordenes/**', (r) => {
      const u = r.request().url();
      if (u.endsWith('/timeline')) return r.fulfill({ json: { timeline: timeline(estado) } });
      if (/\/(photos|danos|warranty)$/.test(u)) return r.fulfill({ status: 404, json: {} });
      return r.fulfill({ json: orden(estado) });
    });
    await p.goto(`${BASE}/seguimiento/${TOKEN}`, { waitUntil: 'networkidle' });
    await p.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
    await p.waitForTimeout(2500);
    const name = `seguimiento-${estado.toLowerCase()}`;
    await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    console.log(name, await p.evaluate(() => document.documentElement.scrollHeight));
    await ctx.close();
  }
  await b.close();
})();
