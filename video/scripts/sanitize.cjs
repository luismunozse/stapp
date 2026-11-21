// Reemplaza nombres, teléfonos y el nombre/logo del taller de las capturas
// reales por datos ficticios, usando Inter (la fuente de la app).
const { chromium } = require('playwright');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const font = (w) => `file://${root}/video/node_modules/@fontsource/inter/files/inter-latin-${w}-normal.woff2`;
const MUTED = 'hsl(215 19% 41%)'; // --muted-foreground app/globals.css
const FG = 'hsl(222.2 84% 4.9%)';  // --foreground
const header = [
  { x: 40, y: 25, w: 520, h: 115, bg: '#fff', html: `<img src="file://${root}/public/favicon.svg" style="width:84px;height:84px;position:absolute;left:12px;top:15px"><span style="position:absolute;left:128px;top:26px;font-weight:700;font-size:52px;white-space:nowrap;color:${FG}">Taller Demo</span>` },
];
const t = (x, y, w, h, text, size, weight, color, bg = '#fff') => ({ x, y, w, h, bg, html: `<span style="position:absolute;left:0;top:0;line-height:${h}px;font-size:${size}px;font-weight:${weight};color:${color};white-space:nowrap">${text}</span>` });
const jobs = {
  'ordenes.png': [...header,
    t(95, 1126, 520, 56, 'Lucía Fernández', 41, 500, FG),
    t(95, 1184, 420, 44, '1155550101', 36, 400, MUTED),
    t(95, 1822, 520, 56, 'Martín Gómez', 41, 500, FG),
    t(95, 1880, 420, 44, '1155550102', 36, 400, MUTED)],
  'clientes.png': [...header,
    t(238, 893, 520, 56, 'Lucía Fernández', 39, 500, FG),
    t(160, 1015, 420, 54, '1155550101', 40, 400, MUTED),
    t(238, 1313, 520, 56, 'Sofía Ruiz', 39, 500, FG),
    t(160, 1435, 420, 54, '1155550103', 40, 400, MUTED),
    t(238, 1732, 520, 56, 'Martín Gómez', 39, 500, FG),
    t(160, 1854, 420, 54, '1155550102', 40, 400, MUTED)],
  'dashboard.png': [...header, t(45, 318, 600, 62, 'Bienvenido, Martín', 42, 400, MUTED, 'rgb(250,252,253)')],
  'inventario.png': [...header],
};
(async () => {
  const b = await chromium.launch();
  for (const [f, patches] of Object.entries(jobs)) {
    const p = await b.newPage({ viewport: { width: 1169, height: 2531 } });
    const html = `<style>${[400,500,700].map(w=>`@font-face{font-family:Inter;font-weight:${w};src:url(${font(w)})}`).join('')}
    body{margin:0;font-family:Inter} .p{position:absolute;overflow:hidden}</style>
    <img src="file://${root}/public/screenshots/${f}" style="display:block">
    ${patches.map(q=>`<div class="p" style="left:${q.x}px;top:${q.y}px;width:${q.w}px;height:${q.h}px;background:${q.bg}">${q.html}</div>`).join('')}`;
    const tmp=`${root}/video/scripts/.tmp-${f}.html`; require('fs').writeFileSync(tmp,html); await p.goto('file://'+tmp); await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${root}/video/public/screens/${f}` }); require('fs').unlinkSync(tmp);
  }
  await b.close();
})();
