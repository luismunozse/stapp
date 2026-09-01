# Calibración de impresora térmica: perfil por dispositivo

**Fecha:** 2026-08-03 · **Estado:** Diseño aprobado

## Contexto

Un usuario con una Bematech LR2000 (80mm) reporta que el comprobante térmico "imprime pero de mala manera", sin evidencia concreta del síntoma. El sistema de impresión actual tiene dos caminos:

- **WebUSB / ESC/POS crudo** (`lib/escpos.ts` + `components/pos/use-thermal-printer.ts`): asume constantes fijas — 48 columnas en 80mm (32 en 58mm), code page CP858 (`ESC t 19`), corte `GS V 65 3`. Ninguna impresora puede desviarse de eso sin imprimir mal.
- **Navegador / driver del SO** (`handleBrowserPrint` en `components/ordenes/thermal-print-orden.tsx` + `lib/print-fit-page.ts`): renderiza HTML; sus fallas son de configuración del driver (papel, márgenes, escala), no del motor.

No existe pantalla de diagnóstico: el usuario descubre el problema imprimiendo un comprobante real, y la app no tiene forma de adaptarse porque nunca pregunta qué salió bien.

## Modos de falla a cubrir (a ciegas)

| # | Síntoma | Causa | Camino |
|---|---------|-------|--------|
| 1 | Texto que se parte / no llega al borde | Columnas reales ≠ 48 (muchas 80mm son de 42) | WebUSB |
| 2 | Acentos garabateados | La impresora no usa CP858 en `ESC t 19` | WebUSB |
| 3 | No corta o imprime caracteres basura al final | `GS V` no soportado (legacy `ESC i`, o sin cortador) | WebUSB |
| 4 | "No se encontró endpoint" / no conecta | `usbprint.sys` (Windows) se apropió del USB y bloquea el claim | WebUSB |
| 5 | Hoja en blanco de más, texto diminuto o cortado a lo ancho | Driver con papel/márgenes/escala mal configurados | Navegador |

## Objetivo

Que la impresión térmica se adapte a **cualquier impresora** sin base de datos de hardware: la app imprime tests físicos cortos, el usuario elige cuál salió bien, y esa elección queda guardada como **perfil de impresora por dispositivo** que consumen tanto el comprobante de órdenes como el ticket de venta del POS.

## Decisiones (cerradas)

1. **Wizard de calibración empírico**, no base de datos por marca/modelo (mantenimiento infinito, los clones mienten el modelo) ni agente local estilo QZ Tray (fricción de instalación). Enfoques descartados en brainstorming.
2. **Un solo perfil por dispositivo/navegador** en localStorage, compartido por órdenes y POS. Las etiquetas (die-cut/rollo) quedan afuera: van por driver del SO y ya funcionan.
3. **Default = comportamiento actual** (48 cols, CP858, `GS V`): cero regresión para quien ya imprime bien.
4. La selección de code page guarda el **par (número de tabla `ESC t n`, encoder)** que el usuario vio funcionar — así absorbe firmwares que mapean `n` distinto del estándar Epson.
5. El camino navegador no usa el perfil (renderiza HTML): su cobertura es página de prueba + guía de driver + mensaje claro cuando WebUSB está bloqueado.

## Arquitectura

### A. Perfil de impresora — `lib/thermal-paper.ts`

Evoluciona el módulo existente (hoy solo guarda el ancho):

```ts
export interface PrinterProfile {
  ancho: 58 | 80
  columnas: number                                      // 32 | 42 | 48
  codepage: "cp437" | "cp850" | "cp858" | "win1252"
  corte: "gsv" | "esci" | "none"
}
```

- Storage: localStorage `stapp:printer-profile` (JSON). `readProfile()` / `saveProfile()` con el mismo patrón SSR-safe y try/catch actual.
- **Migración**: si no hay perfil pero existe el viejo `stapp:comprobante-ancho`, se construye el perfil con ese ancho y defaults actuales. `readAncho`/`saveAncho` pasan a delegar en el perfil (compatibilidad con los call sites existentes).
- Defaults por ancho: 58 → 32 columnas; 80 → 48 columnas; siempre `cp858` + `gsv`.

### B. Motor ESC/POS parametrizado — `lib/escpos.ts`

`generateTicketCommands` (POS) y `generateOrdenTicketCommands` (órdenes) reciben el `PrinterProfile` en lugar del ancho suelto:

- **Encoding**: `textToBytes(text, codepage)`. Tablas: CP850/CP858 comparten mapa (858 = 850 + `€` en `0xD5`); se agregan CP437 (sin `Á Í Ó Ú` → caen a la vocal ASCII sin acento, no a `?`) y Windows-1252 (≈ code points Latin-1 directos).
- **Init**: `ESC t n` con el número de tabla del perfil. Estándar Epson: CP437=0, CP850=2, CP858=19, WPC1252=16 (ver decisión 4: si el firmware mapea distinto, el wizard igual encuentra el par correcto).
- **Corte**: `gsv` → `GS V 65 3` (actual); `esci` → `ESC i` (full cut legacy); `none` → solo feed largo.
- **Columnas**: separadores, `columns()` y `rightAlign()` usan `profile.columnas`.

Call sites a actualizar: `thermal-print-orden.tsx`, `pos-terminal.tsx` (y cualquier otro consumidor de los generadores).

### C. Wizard de calibración — componente nuevo

Accesible desde dos lugares: **Configuración → sección impresora** (donde ya viven tipo/marca/modelo del comprobante) y link "¿Salió mal? Calibrar impresora" en los diálogos de impresión térmica de órdenes y POS.

Los tres pasos de calibración requieren conexión WebUSB (reusa `useThermalPrinter`); la página de prueba del driver (sección D) no la necesita. Cada paso imprime un test corto y pregunta con botones:

1. **Ancho + columnas**: imprime 3 reglas numeradas de exactamente 32, 42 y 48 caracteres con marcador de fin → "¿Cuál es la línea más larga que quedó en un solo renglón?". La respuesta fija `columnas` y deriva `ancho` (32 → 58mm; 42 o 48 → 80mm).
2. **Acentos**: imprime `N) áéíóúñÑ ¿¡ °` una vez por candidata (CP437, CP850, CP858, Win1252), emitiendo `ESC t n` de esa candidata **antes de su línea** → "¿Qué número se lee bien?". Fija `codepage`.
3. **Corte**: imprime 3 bloques numerados, cada uno seguido de su variante (`GS V`, `ESC i`, solo feed) → "¿Después de qué número cortó?" o "No corta" → fija `corte`.

Cada respuesta persiste al instante vía `saveProfile()`. Al terminar: impresión de un ticket de prueba completo con el perfil resultante.

### D. Camino navegador y manejo de errores

- **Página de prueba del driver**: botón en el wizard que dispara el flujo `handleBrowserPrint` con contenido de prueba, para verificar la configuración del driver sin imprimir un comprobante real.
- **Guía corta** visible en el wizard: papel 80mm (o 58), márgenes 0, escala 100%.
- **Claim bloqueado (Windows)**: cuando `claimInterface`/`open` falla (típicamente `SecurityError`/"Unable to claim interface" porque `usbprint.sys` tiene el dispositivo), `use-thermal-printer.ts` traduce el error a un mensaje accionable: "Windows está usando el driver de esta impresora. Usá 'Imprimir (navegador)', que imprime por ese driver" — en lugar del error críptico actual.

### E. Testing (Strict TDD, `npm test`)

- Tablas de encoding: bytes correctos por codepage, fallbacks de CP437, `€` solo en CP858.
- Generadores: `ESC t n` según perfil, variante de corte, ancho de separadores/columnas.
- Perfil: read/write, migración desde `stapp:comprobante-ancho`, defaults por ancho, JSON corrupto → defaults.
- Wizard: tests de componente para la máquina de pasos (qué comandos imprime cada paso, qué persiste cada respuesta).
- Actualizar los existentes: `escpos-cp858.test.ts`, `escpos-orden-ticket.test.ts`, `thermal-paper.test.ts`.
- La salida física no es testeable automatizadamente; el ticket de prueba final del wizard es la verificación manual.

## Fuera de alcance

- Etiquetas (térmica multi-tamaño por driver, #249) — ya funcionan.
- Base de datos de presets por marca/modelo — se puede sumar después como atajo si duele.
- Perfil por organización o en servidor: la impresora es física del dispositivo, localStorage es el scope correcto (mismo criterio que el ancho hoy).
- Reemplazo de driver USB (Zadig/WinUSB): no se guía a usuarios no técnicos a tocar drivers; el fallback es el camino navegador.
