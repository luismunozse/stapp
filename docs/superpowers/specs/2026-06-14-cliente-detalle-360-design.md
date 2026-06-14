# Detalle 360 de cliente

**Fecha:** 2026-06-14 · **Estado:** Diseño aprobado

## Problema

La sección de clientes no tiene página de detalle. Hoy `/clientes` es solo una
lista con búsqueda y diálogos sueltos (cuenta corriente, cobrar, WhatsApp). Para
entender a un cliente — cuánto debe, qué órdenes tuvo, qué cotizaciones, sus
contactos por sector — el usuario tiene que abrir varios diálogos o no puede
verlo. Falta una vista consolidada por cliente y los filtros de la lista son
mínimos (solo `search`).

Este cambio cubre **únicamente el detalle 360**. Los filtros y el enriquecimiento
de la lista quedan fuera de alcance (posible slice posterior).

## Objetivo

Crear una página `/clientes/[id]` que consolide en un solo lugar todo lo
relevante de un cliente del taller: datos de contacto, cuenta corriente, deuda
pendiente con cobro rápido, historial de órdenes, cotizaciones y — para empresas
— sus sectores con contactos. Reusar las APIs y diálogos que ya existen; agregar
solo lo mínimo de backend.

## Decisiones (cerradas)

1. **Layout de scroll único** (no tabs, no sheet lateral). La data por cliente es
   acotada; tabs serían sobre-ingeniería y un sheet no es compartible por URL ni
   cómodo en mobile.
2. **Ruta nueva `/clientes/[id]`** dentro del grupo `(dashboard)`. El click en la
   fila (desktop) y en la card (mobile) navega ahí. Las acciones inline de la
   lista (editar, whatsapp, cobrar, eliminar) se mantienen con `stopPropagation`.
3. **Filtro `clienteId` en GETs existentes** (`/api/ordenes`, `/api/cotizaciones`)
   en vez de endpoints nuevos. Es el patrón que ya usan (un filtro más) y queda
   reusable. No se crean tablas ni migraciones.
4. **Sin cambios de modelo de datos.** Toda la data ya existe.
5. **Refactor oportuno:** extraer la lógica de cuenta corriente (saldo +
   movimientos + depósito) de `CuentaCorrienteDialog` a un componente compartido,
   para no duplicarla entre el diálogo (lista) y la página de detalle.

## Arquitectura

### Ruta y composición

`app/(dashboard)/clientes/[id]/page.tsx` — Server Component:
- Lee `params.id`.
- No hace fetch propio crítico: delega a secciones client con SWR para que cada
  bloque cargue/recargue independiente (saldo cambia tras depósito, órdenes tras
  cobro, etc.). El server solo valida sesión vía el layout existente.
- Si el cliente no existe (404 del API), la sección de header muestra
  not-found / redirige a `/clientes`.

Estructura visual (de arriba a abajo):

```
┌─ Header sticky ─────────────────────────────────────┐
│ ← Volver   [Avatar] Nombre  [badge tipo/Empresa]    │
│ tel · email · DNI/CUIT          [Editar] [WhatsApp] │
│ ┌─────────┬───────────────────┬──────────┐          │
│ │ Saldo   │ Deuda pendiente   │ # Órdenes│ (resumen)│
│ └─────────┴───────────────────┴──────────┘          │
├──────────────────────────────────────────────────────┤
│ 1. Datos & contacto                                  │
│ 2. Cuenta corriente (saldo + movimientos + depósito) │
│ 3. Órdenes pendientes de cobro  [Cobrar todo]        │
│ 4. Historial de órdenes (tabla paginada)             │
│ 5. Cotizaciones (tabla)                              │
│ 6. Sectores (solo EMPRESA)                           │
└──────────────────────────────────────────────────────┘
```

### Componentes nuevos

`components/clientes/detalle/` (carpeta nueva):
- `cliente-detalle.tsx` — orquestador client; recibe `clienteId`, hace SWR a
  `GET /api/clientes/[id]`, arma header + resumen + secciones. Maneja estado de
  diálogos (editar, whatsapp, cobrar).
- `cliente-detalle-header.tsx` — header sticky + cards de resumen.
- `cliente-detalle-datos.tsx` — datos de contacto, dirección, opt-in WhatsApp,
  razón social/CUIT.
- `cuenta-corriente-panel.tsx` — **componente compartido** extraído del diálogo
  (ver refactor abajo). Variante embebida (sin Dialog wrapper).
- `cliente-ordenes-pendientes.tsx` — usa `/api/clientes/[id]/ordenes-pendientes`
  + botón "Cobrar todo" → `CobrarMultipleDialog`.
- `cliente-ordenes-historial.tsx` — tabla paginada vía `/api/ordenes?clienteId=`.
- `cliente-cotizaciones.tsx` — tabla vía `/api/cotizaciones?clienteId=`.
- `cliente-sectores.tsx` — solo si `tipoCliente === "EMPRESA"`; lista de sectores
  con contactos (data ya en `GET /api/clientes/[id]`).

### Refactor de cuenta corriente

Extraer el cuerpo de `CuentaCorrienteDialog` (saldo, form de depósito, lista de
movimientos, fetch a `/api/clientes/[id]/cuenta-corriente`) a
`cuenta-corriente-panel.tsx`. El diálogo existente pasa a renderizar el panel
dentro de su `DialogContent`. La página de detalle renderiza el mismo panel
embebido (dentro de un `Card`). El gate de ADMIN para depósito (ya en el POST del
API) se refleja en la UI del panel: el botón "Registrar Depósito" se oculta si
`useSession()` (next-auth/react) reporta `role !== "ADMIN"`. El servidor sigue
siendo la fuente de verdad (devuelve 403 igual). El diálogo actual hoy muestra el
botón siempre; el panel compartido pasa a ocultarlo para no-ADMIN, mejorando ese
comportamiento en ambos usos.

### Cambios de backend

1. **`GET /api/ordenes`** — agregar lectura de `searchParams.get("clienteId")`.
   Si viene, agregar `.eq("cliente_id", clienteId)` a la query. No rompe llamadas
   existentes (param opcional).
2. **`GET /api/cotizaciones`** — idem: leer `clienteId` opcional y filtrar por
   `cliente_id`. Mantener paginación/orden existentes.

Ambos endpoints ya verifican `organization_id` vía `requireAuth`; el filtro por
cliente se suma a esa restricción (no la reemplaza).

### Navegación desde la lista

En `components/clientes/clientes-list.tsx`:
- Desktop (`DataTable`): el row ya soporta `onClick` (las acciones usan
  `stopPropagation`). Agregar navegación `router.push(/clientes/${id})` en el
  click de fila.
- Mobile (`ClienteMobileCard`): agregar navegación equivalente en el cuerpo de la
  card (respetando `stopPropagation` de los botones existentes).

## Contrato de datos (sin cambios de esquema)

- `GET /api/clientes/[id]` → cliente + `sectores[]` + `ordenes[]` (últimas 10).
  Ya existe. Se usa para header, datos y sectores.
- `GET /api/clientes/[id]/cuenta-corriente?page&limit` → `{ saldo, movimientos[],
  total, page, limit }`. Ya existe.
- `GET /api/clientes/[id]/ordenes-pendientes` → órdenes con `pendiente > 0`. Ya
  existe. Se usa para la card "Deuda pendiente" y la sección de cobro.
- `GET /api/ordenes?clienteId=&page&limit&sortBy&sortOrder` → historial completo.
  **Requiere agregar el filtro `clienteId`.**
- `GET /api/cotizaciones?clienteId=&page&limit` → cotizaciones del cliente.
  **Requiere agregar el filtro `clienteId`.**

## Cards de resumen — origen de cada número

- **Saldo:** `saldo` de `/cuenta-corriente`.
- **Deuda pendiente:** suma de `pendiente` de `/ordenes-pendientes`.
- **# Órdenes:** total del historial (`total` de `/api/ordenes?clienteId=`).

## Manejo de errores y estados

- **Cliente inexistente:** `GET /api/clientes/[id]` devuelve 404 → la página
  muestra estado not-found con link a `/clientes`.
- **Loading por sección:** cada sección con su propio skeleton (patrón ya usado en
  la lista mobile). El header carga primero; las secciones cargan en paralelo.
- **Secciones vacías:** `EmptyState` (componente existente) por sección
  (sin órdenes, sin cotizaciones, sin movimientos, sin sectores).
- **Empresa vs individual:** sección Sectores solo se renderiza si
  `tipoCliente === "EMPRESA"`.
- **Permisos:** depósito a cuenta corriente solo visible/habilitado para ADMIN
  (el POST ya lo gatea; la UI lo refleja).

## Testing

Modo TDD activo. Cobertura:

- **API `/api/ordenes?clienteId=`:** test de que filtra por cliente y respeta
  `organization_id`; sin el param, comportamiento previo intacto.
- **API `/api/cotizaciones?clienteId=`:** idem.
- Los tests existentes (`__tests__/api/clientes.test.ts`,
  `v1-clientes.test.ts`) deben seguir verdes.
- Componentes de detalle: smoke/render con data mockeada por sección (header,
  resumen, secciones vacías vs con data, gate de empresa).

## Fuera de alcance

- Filtros nuevos en la lista de clientes (tipo, deudores, sectores, fecha).
- Enriquecer columnas de la lista.
- Edición inline en el detalle (se reusa `ClienteForm` en diálogo).
- Paginación server nueva para sectores (vienen completos en el GET).
- Cambios de esquema / migraciones.

## Plan de entrega

Un solo PR. Orden sugerido de implementación:
1. Backend: filtro `clienteId` en `/api/ordenes` y `/api/cotizaciones` + tests.
2. Refactor `cuenta-corriente-panel.tsx` + ajustar diálogo.
3. Ruta `/clientes/[id]` + componentes de detalle por sección.
4. Navegación desde lista (desktop + mobile).
5. Verificación manual + tests verdes.
