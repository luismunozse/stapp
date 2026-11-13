# Diagrama de daños en la recepción (v1) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que al recibir un equipo se marquen los daños sobre un dibujo del equipo; los de la recepción quedan inalterables y el técnico puede sumar daños detectados en diagnóstico, todo visible en el detalle, el seguimiento público, el PDF y el ticket.

**Architecture:** tabla `orden_danos` (una fila por pin) con triggers que garantizan las reglas, más un RPC atómico para la recepción. Catálogo de dibujos SVG versionado en código y compartido entre la interfaz y el PDF. La API reutiliza `cargarOrdenEnAlcance` para los permisos; la interfaz son tres componentes chicos que se enchufan en el formulario, el detalle y el seguimiento.

**Tech Stack:** Next.js App Router, Supabase Postgres (migraciones a mano con `node scripts/db-run.mjs`), zod, React, Tailwind, `pdf-lib`, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-diagrama-danos-design.md`

## Global Constraints

- Migración **408**. Archivos: `supabase/migrations/408_orden_danos.sql`, `verify/408_probes.sql`, `rollback/408_rollback.sql`.
- Tipos de daño, exactamente: `rayon`, `golpe`, `rotura`, `faltante`, `humedad`, `otro`. Etiquetas: "Rayón", "Golpe", "Rotura", "Faltante", "Humedad", "Otro".
- `momento`: `recepcion` | `diagnostico`. `vista`: `frente` | `dorso` | `lateral`.
- `x`, `y` entre 0 y 1. `nota` de hasta 200 caracteres. Hasta 30 pins por orden.
- Ventana para borrar un pin de diagnóstico: 10 minutos. Ventana del RPC de recepción: la orden creada hace 10 minutos o menos.
- Estados en los que no se agregan pins: `ENTREGADO`, `ENTREGADO_SIN_REPARACION`, `ENTREGADO_SIN_COBRO`, `CANCELADO`.
- Referencia de diagrama: `<id>@<version>` (por ejemplo `celular@1`). Diagramas v1: `celular`, `tablet`, `computadora`, `consola`, `smartwatch`, `impresora`, `generico`.
- Textos de la interfaz en español rioplatense (voseo). Botones de al menos 44 px. Paridad con el modo oscuro.
- La API usa `supabaseAdmin` (service role): **toda** consulta filtra por `organization_id` o pasa por `cargarOrdenEnAlcance`.
- El seguimiento público nunca expone `created_by` ni nombres de empleados.

## Review Focus

1. **Se cambia el tipo de equipo en el formulario después de marcar pins.** Lo esperado: se pide confirmación y se borran los pins, porque pertenecen a otro dibujo. Prueba en la tarea 8.
2. **La orden cambia de tipo de equipo después de creada** (edición de la orden). Lo esperado: los pins existentes se siguen dibujando con su `diagrama` guardado, y los pins de diagnóstico nuevos usan el diagrama de los pins de recepción si existen. Prueba en la tarea 6.
3. **Se restaura un borrador viejo con pins de forma inválida o con otro diagrama.** Lo esperado: se descartan los pins inválidos sin romper el formulario, igual que hoy se hace con `accesoriosSeleccionados`. Prueba en la tarea 8.
4. **Nota de 200 caracteres sin espacios, o con emojis, en el PDF.** Lo esperado: se corta en varias líneas dentro del bloque, sin desbordar ni romper la fuente. Prueba en la tarea 11.
5. **Se toca en el borde del dibujo o fuera del área del SVG.** Lo esperado: las coordenadas se limitan a [0, 1] y el pin queda visible entero. Prueba en la tarea 7.

---

### Task 1: Migración 408 (tabla, columnas, triggers, RPC)

**Files:**
- Create: `supabase/migrations/408_orden_danos.sql`
- Create: `supabase/migrations/verify/408_probes.sql`
- Create: `supabase/migrations/rollback/408_rollback.sql`
- Test: `__tests__/orden-danos-migration.test.ts`

**Interfaces:**
- Produces: tabla `orden_danos` (columnas del spec), `ordenes_servicio.recepcion_sin_danos`, `organizations.danos_recepcion_obligatorio`, y la función `registrar_estado_fisico_recepcion(p_orden_id TEXT, p_organization_id TEXT, p_danos JSONB, p_sin_danos BOOLEAN, p_user_id TEXT) RETURNS INT` (cantidad de pins insertados). Cada elemento de `p_danos` tiene la forma `{diagrama, vista, x, y, tipo, nota}`. Los errores de negocio usan `RAISE EXCEPTION ... USING ERRCODE = 'P0001'` con estos mensajes exactos: `DANOS_RECEPCION_YA_REGISTRADA`, `DANOS_RECEPCION_FUERA_DE_VENTANA`, `DANOS_ORDEN_CERRADA`, `DANOS_RECEPCION_INMUTABLE`, `DANOS_DIAGNOSTICO_FUERA_DE_VENTANA`, `DANOS_SIN_DANOS_CON_PINS`, `DANOS_LIMITE`.

- [ ] **Step 1: Write the failing test** `__tests__/orden-danos-migration.test.ts`, siguiendo el patrón de `__tests__/beta-android-migration.test.ts` (lectura del SQL como texto):
  - `it("tabla con CHECKs de tipo, momento, vista, rango y nota")`: hace match de `CHECK (tipo IN ('rayon', 'golpe', 'rotura', 'faltante', 'humedad', 'otro'))`, `CHECK (momento IN ('recepcion', 'diagnostico'))`, `CHECK (x >= 0 AND x <= 1)`, `CHECK (char_length(nota) <= 200)` y `UNIQUE (orden_id, numero)`.
  - `it("RLS: select por organización y all para service_role, sin escritura para authenticated")`: `get_current_organization_id()` en la policy SELECT, `REVOKE ALL ON public.orden_danos FROM PUBLIC, anon, authenticated` y `GRANT SELECT ON public.orden_danos TO authenticated`.
  - `it("columnas de configuración con default false")`: `recepcion_sin_danos BOOLEAN NOT NULL DEFAULT false` y `danos_recepcion_obligatorio BOOLEAN NOT NULL DEFAULT false`.
  - `it("los pins de recepción solo entran por el RPC")`: el trigger lee `current_setting('stapp.danos_recepcion', true)` y el RPC hace `set_config('stapp.danos_recepcion', 'on', true)`.
  - `it("todos los códigos de error del contrato")`: cada uno de los 7 mensajes de error aparece en el archivo.

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run __tests__/orden-danos-migration.test.ts`
  Expected: FAIL (ENOENT, la migración no existe).

- [ ] **Step 3: Write `408_orden_danos.sql`** con:
  - La tabla, con la policy y los grants de `407_multimoneda_cotizaciones.sql:54-62`.
  - Índice en `(orden_id)`.
  - Trigger `BEFORE INSERT` `orden_danos_before_insert`:
    1. Rechaza si el estado de la orden está entre los estados sin nuevos pins (`DANOS_ORDEN_CERRADA`).
    2. Toma `SELECT ... FOR UPDATE` sobre `ordenes_servicio`.
    3. Rechaza si ya hay 30 pins (`DANOS_LIMITE`).
    4. Si el pin es `recepcion` y la variable de sesión no está en `'on'`, rechaza (`DANOS_RECEPCION_INMUTABLE`).
    5. Si el pin es `recepcion` y la orden tiene `recepcion_sin_danos`, rechaza (`DANOS_SIN_DANOS_CON_PINS`).
    6. Asigna `NEW.numero := coalesce(max(numero), 0) + 1`.
  - Trigger `BEFORE UPDATE`: siempre `DANOS_RECEPCION_INMUTABLE`.
  - Trigger `BEFORE DELETE`:
    - si es `recepcion` y la orden todavía existe, `DANOS_RECEPCION_INMUTABLE` (así el borrado en cascada pasa, porque la orden ya no existe);
    - si es `diagnostico` y `now() - created_at >= interval '10 minutes'`, `DANOS_DIAGNOSTICO_FUERA_DE_VENTANA`.
  - Trigger en `ordenes_servicio` `BEFORE UPDATE OF recepcion_sin_danos`: rechaza pasar a `true` si hay pins de recepción.
  - El RPC `registrar_estado_fisico_recepcion`, con `SECURITY DEFINER` y `SET search_path = public`:
    - valida que la orden pertenezca a `p_organization_id`, que `created_at > now() - interval '10 minutes'` y que no haya pins de recepción ni `recepcion_sin_danos`;
    - activa la variable de sesión;
    - si `p_sin_danos`, hace UPDATE del flag; si no, inserta los pins desde `jsonb_to_recordset` con `momento = 'recepcion'` y `created_by = p_user_id`;
    - el `GRANT EXECUTE` va solo a `service_role`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run __tests__/orden-danos-migration.test.ts`
  Expected: PASS

- [ ] **Step 5: Write `verify/408_probes.sql`** con el patrón de `verify/407_probes.sql`: transacción, `pg_temp.probe` y `ROLLBACK` al final. Las pruebas:
  1. El RPC inserta 2 pins y devuelve `2`, numerados 1 y 2.
  2. Un segundo RPC sobre la misma orden da `P0001` (ya registrada).
  3. INSERT directo de un pin `recepcion` da `P0001`.
  4. UPDATE de un pin da `P0001`.
  5. DELETE de un pin de recepción da `P0001`.
  6. Pin de diagnóstico: el INSERT da `ok` y el DELETE inmediato da `ok`.
  7. Pin de diagnóstico con `created_at` forzado a hace 11 minutos (se fuerza deshabilitando el trigger dentro de la transacción de prueba): el DELETE da `P0001`.
  8. Orden en `ENTREGADO`: el INSERT de diagnóstico da `P0001`.
  9. RPC con `p_sin_danos = true` sobre una orden con pins da `P0001`.
  10. `x = 1.5` da `23514` (violación de CHECK).
  11. RPC con una orden creada hace 11 minutos da `P0001`.
  12. DELETE de la orden borra sus pins en cascada (`ok`).
  13. Ensayo del rollback.

- [ ] **Step 6: Write `rollback/408_rollback.sql`**: borra los triggers, la función, la tabla y las dos columnas.

- [ ] **Step 7: Commit**
  ```bash
  git add supabase/migrations/408_orden_danos.sql supabase/migrations/verify/408_probes.sql supabase/migrations/rollback/408_rollback.sql __tests__/orden-danos-migration.test.ts
  git commit -m "feat(db): orden_danos con recepción inmutable y RPC atómico (408)"
  ```
  La migración **no se aplica a producción** en este plan: queda anotada como pendiente de despliegue (ver memoria `migraciones-pendientes-auditoria`).

---

### Task 2: Catálogo de dibujos

**Files:**
- Create: `components/ordenes/danos/diagramas.ts`
- Test: `components/ordenes/danos/__tests__/diagramas.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type VistaId = "frente" | "dorso" | "lateral"
  export interface VistaDiagrama { id: VistaId; label: string; viewBox: string; paths: string[] }
  export interface Diagrama { id: string; version: number; vistas: VistaDiagrama[] }
  export const DIAGRAMA_GENERICO_ID = "generico"
  export function refDiagrama(d: Diagrama): string                 // "celular@1"
  export function resolverDiagrama(codigoTipo: string | null | undefined): Diagrama
  export function diagramaPorRef(ref: string): Diagrama
  ```

- [ ] **Step 1: Write the failing test** `diagramas.test.ts`:
  - `resolverDiagrama("CELULAR").id === "celular"`, y lo mismo para `TABLET`, `COMPUTADORA`, `CONSOLA`, `SMARTWATCH` e `IMPRESORA`.
  - `resolverDiagrama("TALADRO").id === "generico"`. `resolverDiagrama(null).id === "generico"`.
  - `refDiagrama(resolverDiagrama("CELULAR")) === "celular@1"`.
  - `diagramaPorRef("celular@1").id === "celular"`. `diagramaPorRef("celular@99").id === "generico"`. `diagramaPorRef("basura").id === "generico"`.
  - Todo diagrama tiene al menos 2 vistas, y la primera es `frente`.
  - Todo `path` parsea como path SVG: hace match de `/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/` y empieza con `M`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run components/ordenes/danos/__tests__/diagramas.test.ts`
  Expected: FAIL (el módulo no existe).

- [ ] **Step 3: Implement `diagramas.ts`**
  - Un registro interno `Record<"<id>@<version>", Diagrama>` y un mapa de código de tipo a id.
  - Trazos de línea simple. Usar `viewBox` `"0 0 100 200"` para celular y smartwatch, y `"0 0 200 140"` para computadora, consola e impresora.
  - Vistas por diagrama:
    - celular y tablet: frente (pantalla, marco, cámara frontal) y dorso (cámaras, logo);
    - computadora: frente (tapa y teclado abiertos) y dorso (tapa cerrada);
    - consola: frente (equipo y joystick) y dorso (puertos);
    - smartwatch: frente y dorso;
    - impresora: frente (bandeja) y dorso;
    - genérico: frente y dorso, como rectángulos con esquinas redondeadas.
  - Sin dependencias de React: es un módulo puro.

- [ ] **Step 4: Run test to verify it passes** (el mismo comando). Expected: PASS.

- [ ] **Step 5: Commit** `feat(ordenes): catálogo de dibujos para el diagrama de daños`

---

### Task 3: Dominio compartido (tipos de daño y validación)

**Files:**
- Create: `lib/ordenes/danos.ts`
- Test: `lib/ordenes/__tests__/danos.test.ts`

**Interfaces:**
- Consumes: `diagramaPorRef` y `resolverDiagrama` (tarea 2).
- Produces:
  ```ts
  export const TIPOS_DANO = ["rayon","golpe","rotura","faltante","humedad","otro"] as const
  export type TipoDano = typeof TIPOS_DANO[number]
  export const TIPO_DANO_META: Record<TipoDano, { label: string; icon: LucideIconName; colorClass: string; pdfRgb: [number, number, number] }>
  export const MAX_DANOS_POR_ORDEN = 30
  export const VENTANA_BORRADO_DIAGNOSTICO_MS = 10 * 60 * 1000
  export const ESTADOS_SIN_NUEVOS_DANOS = ["ENTREGADO","ENTREGADO_SIN_REPARACION","ENTREGADO_SIN_COBRO","CANCELADO"] as const
  export const danoInputSchema: z.ZodType<DanoInput>      // { diagrama, vista, x, y, tipo, nota? }
  export type DanoInput = { diagrama: string; vista: VistaId; x: number; y: number; tipo: TipoDano; nota?: string | null }
  export interface DanoOrden extends DanoInput { id: string; numero: number; momento: "recepcion" | "diagnostico"; createdAt: string; createdByNombre: string | null }
  export function validarDanosParaTipo(danos: DanoInput[], codigoTipo: string | null): { ok: true } | { ok: false; error: string }
  export function mensajeErrorDanos(err: unknown): { status: 409 | 422 | 500; error: string }
  ```

- [ ] **Step 1: Write the failing test** `danos.test.ts`:
  - `danoInputSchema` rechaza `x: -0.01`, `y: 1.01`, `tipo: "quemado"`, `vista: "arriba"`, y una `nota` de 201 caracteres. Acepta `{diagrama:"celular@1", vista:"frente", x:0, y:1, tipo:"golpe"}`.
  - `validarDanosParaTipo` con `[{diagrama:"tablet@1",...}]` y el tipo `"CELULAR"` devuelve `{ok:false}` con un error que contiene "no corresponde".
  - Con `vista:"lateral"` en `celular@1` (que no tiene lateral) devuelve `{ok:false}`.
  - Con 31 daños devuelve `{ok:false}` con un error que contiene "30".
  - `mensajeErrorDanos({code:"P0001", message:"DANOS_ORDEN_CERRADA"})` devuelve `{status:409, error:"La orden ya está cerrada"}`.
  - `DANOS_DIAGNOSTICO_FUERA_DE_VENTANA` da 409 con "Pasaron más de 10 minutos; el daño ya no se puede borrar".
  - `DANOS_LIMITE` da 422 con "Máximo 30 daños por orden".
  - Cualquier otro error da 500 con "No se pudo guardar el estado físico".

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run lib/ordenes/__tests__/danos.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `lib/ordenes/danos.ts`**
  - Colores por tipo, que funcionan en modo claro y oscuro:
    - rayón: `text-amber-600 dark:text-amber-400`
    - golpe: `text-orange-600 dark:text-orange-400`
    - rotura: `text-red-600 dark:text-red-400`
    - faltante: `text-violet-600 dark:text-violet-400`
    - humedad: `text-sky-600 dark:text-sky-400`
    - otro: `text-slate-600 dark:text-slate-300`
  - Íconos de lucide: `PenLine`, `CircleDot`, `Zap`, `CircleOff`, `Droplets`, `MoreHorizontal`.
  - El resto de los errores `DANOS_*` también se mapean a 409 con un texto claro.

- [ ] **Step 4: Run test to verify it passes.** Expected: PASS.

- [ ] **Step 5: Commit** `feat(ordenes): dominio de daños (tipos, validación y errores)`

---

### Task 4: Configuración "Exigir estado físico"

**Files:**
- Create: `app/api/configuracion/danos/route.ts`
- Create: `components/configuracion/danos-config.tsx`
- Modify: `components/configuracion/configuracion-form.tsx` (montarla junto a `GarantiasConfig`, alrededor de la línea 99, con el mismo patrón)
- Modify: `app/api/configuracion/operativa/route.ts` (exponer `danosRecepcionObligatorio`)
- Test: `__tests__/api/configuracion-danos.test.ts`, `__tests__/components/danos-config.test.tsx`

**Interfaces:**
- Produces:
  - `GET /api/configuracion/danos` devuelve `{ obligatorio: boolean }`. `PUT` recibe `{ obligatorio: boolean }`, solo ADMIN (`requireAdmin`), y devuelve `{ obligatorio }`.
  - `GET /api/configuracion/operativa` suma `danosRecepcionObligatorio: boolean`, que vale `false` si la columna no existe (por el `select("*")`, ver el comentario de la línea 25 de esa ruta).

- [ ] **Step 1: Write the failing tests**, con los mocks de las pruebas de API existentes en `__tests__/api/`:
  - El PUT como VENDEDOR da 403.
  - El PUT como ADMIN con `{obligatorio:true}` hace update de `organizations.danos_recepcion_obligatorio` filtrando por `id = organizationId`, y responde 200 con `{obligatorio:true}`.
  - El PUT con `{obligatorio:"si"}` da 400.
  - `operativa` con una organización sin la columna devuelve `danosRecepcionObligatorio: false`.
  - En el componente: el switch con la etiqueta "Exigir estado físico al recibir un equipo" llama a `onChange(true)`.

- [ ] **Step 2: Run them to verify they fail.**
  Run: `npx vitest run __tests__/api/configuracion-danos.test.ts __tests__/components/danos-config.test.tsx`

- [ ] **Step 3: Implement** la ruta, el componente (que copia la estructura de `garantias-config.tsx`) y el campo en `operativa`. Ayuda del switch: "Si está activo, no se puede crear una orden sin marcar los daños o indicar «Sin daños visibles»."

- [ ] **Step 4: Run tests.** Expected: PASS.

- [ ] **Step 5: Commit** `feat(config): exigir estado físico en la recepción`

---

### Task 5: Registrar la recepción al crear la orden

**Files:**
- Modify: `app/api/ordenes/route.ts` (`ordenSchema` en la línea 54, y el bloque posterior al insert de la línea 514)
- Test: `__tests__/api/ordenes-danos-recepcion.test.ts`

**Interfaces:**
- Consumes: `danoInputSchema`, `validarDanosParaTipo`, `MAX_DANOS_POR_ORDEN` y `mensajeErrorDanos` (tarea 3); el RPC `registrar_estado_fisico_recepcion` (tarea 1).
- Produces: `POST /api/ordenes` acepta `danos?: DanoInput[]` (de 0 a 30) y `recepcionSinDanos?: boolean`. En éxito, la respuesta suma `estadoFisicoGuardado: boolean`.

- [ ] **Step 1: Write the failing tests**, con los mocks de las pruebas existentes de `POST /api/ordenes` en `__tests__/api/`:
  - `danos` y `recepcionSinDanos:true` juntos dan 400 "No podés marcar daños y «Sin daños visibles» a la vez".
  - Un daño con un diagrama de otro tipo da 400, y no se llama a `insert`.
  - Con la organización en obligatorio, sin `danos` y sin `recepcionSinDanos`, da 422 "Marcá el estado físico del equipo o indicá «Sin daños visibles»", y no se llama a `insert`.
  - En el caso feliz con 2 daños, se llama a `rpc("registrar_estado_fisico_recepcion", {p_orden_id, p_organization_id, p_danos, p_sin_danos:false, p_user_id})` y la respuesta es 201 con `estadoFisicoGuardado:true`.
  - Si el RPC falla con la organización en obligatorio, se llama a `delete().eq("id", orden.id).eq("organization_id", orgId)` y la respuesta es 500 con el error de `mensajeErrorDanos`.
  - Si el RPC falla con la organización en opcional, la respuesta es 201 con `estadoFisicoGuardado:false`.
  - Sin `danos` y sin `recepcionSinDanos` en una organización opcional, el RPC **no** se llama.

- [ ] **Step 2: Run to verify they fail.**
  Run: `npx vitest run __tests__/api/ordenes-danos-recepcion.test.ts`

- [ ] **Step 3: Implement**
  - Sumar los campos al `ordenSchema`.
  - Validar antes del insert (después de `validarClienteYSector`). El flag obligatorio se lee de `organizations` en la misma consulta que ya se use para la organización, o en una nueva con `select("danos_recepcion_obligatorio")`.
  - Llamar al RPC después del insert y antes de las fotos.
  - La compensación tiene que ocurrir antes de encolar notificaciones o de registrar `orden_eventos`.
  - Agregar un comentario de que la compensación puede dejar un hueco en la numeración, como acepta el spec.

- [ ] **Step 4: Run tests,** y además las pruebas existentes de `POST /api/ordenes`. Expected: PASS, sin regresiones.
  Run: `npx vitest run __tests__/api/ordenes`

- [ ] **Step 5: Commit** `feat(ordenes): registrar estado físico de recepción al crear la orden`

---

### Task 6: API de daños de la orden (listar, agregar en diagnóstico, borrar)

**Files:**
- Create: `app/api/ordenes/[id]/danos/route.ts` (GET, POST)
- Create: `app/api/ordenes/[id]/danos/[danoId]/route.ts` (DELETE)
- Create: `lib/ordenes/danos-server.ts`
- Test: `__tests__/api/ordenes-danos.test.ts`

**Interfaces:**
- Consumes: `cargarOrdenEnAlcance` y `actorDeSesion` (`lib/ordenes/alcance.ts`), con la acción `"ver"` para GET y `"reparar"` para POST y DELETE; las utilidades de la tarea 3.
- Produces:
  - `listarDanosOrden(ordenId: string, organizationId: string, opts: { incluirAutor: boolean }): Promise<{ danos: DanoOrden[]; sinDanos: boolean; diagrama: string }>`, en `lib/ordenes/danos-server.ts`. `diagrama` es la referencia del primer pin de recepción si existe y, si no, `refDiagrama(resolverDiagrama(orden.tipo_dispositivo))`.
  - GET devuelve `{ danos, sinDanos, diagrama }`.
  - POST recibe un `DanoInput` y devuelve 201 con un `DanoOrden`.
  - DELETE devuelve 204.

- [ ] **Step 1: Write the failing tests:**
  - GET de una orden fuera del alcance da 404, por la convención de `cargarOrdenEnAlcance`.
  - GET ordena por `numero` y mapea `created_by` a `createdByNombre`.
  - El `diagrama` del GET es el de los pins de recepción aunque `tipo_dispositivo` cambió (punto 2 del Review Focus).
  - POST como TECNICO no asignado da 404.
  - POST con un `diagrama` distinto del de la orden da 400.
  - POST cuando la base devuelve `DANOS_ORDEN_CERRADA` da 409 "La orden ya está cerrada".
  - El insert del POST usa `momento: "diagnostico"`, `organization_id` y `created_by: userId`.
  - DELETE de un pin de otra orden da 404, porque filtra por `orden_id` **y** `organization_id`.
  - DELETE fuera de la ventana da 409 con el texto de la tarea 3.

- [ ] **Step 2: Run to verify they fail.**
  Run: `npx vitest run __tests__/api/ordenes-danos.test.ts`

- [ ] **Step 3: Implement** las rutas y `listarDanosOrden`. El nombre del autor se obtiene con un join a `users(nombre)`.

- [ ] **Step 4: Run tests.** Expected: PASS.

- [ ] **Step 5: Commit** `feat(ordenes): API para listar, agregar y borrar daños de diagnóstico`

---

### Task 7: Componentes del diagrama

**Files:**
- Create: `components/ordenes/danos/diagrama-danos.tsx`, `components/ordenes/danos/selector-tipo-dano.tsx`, `components/ordenes/danos/lista-danos.tsx`
- Test: `components/ordenes/danos/__tests__/diagrama-danos.test.tsx`

**Interfaces:**
- Consumes: el catálogo (tarea 2) y `TIPO_DANO_META` (tarea 3).
- Produces:
  ```tsx
  type PinVista = DanoInput & { numero: number; momento?: "recepcion" | "diagnostico"; id?: string }
  <DiagramaDanos diagrama: string; pins: PinVista[]; editable: boolean;
                 onAgregar?: (p: Omit<DanoInput, "diagrama">) => void; resaltado?: number | null; onSeleccionar?: (numero: number) => void />
  <SelectorTipoDano open: boolean; onElegir: (tipo: TipoDano, nota: string | null) => void; onCerrar: () => void />
  <ListaDanos pins: PinVista[]; onQuitar?: (numero: number) => void; onBorrar?: (id: string) => void;
              puedeBorrar?: (p: PinVista) => boolean; mostrarAutor?: boolean; resaltado?: number | null; onSeleccionar?: (numero: number) => void />
  ```

- [ ] **Step 1: Write the failing tests:**
  - Se renderizan pestañas "Frente" y "Dorso" para `celular@1`. Al cambiar de pestaña solo se ven los pins de esa vista.
  - En modo editable, un clic en (50%, 25%) del SVG (con `getBoundingClientRect` mockeado) abre el selector. Al elegir "Golpe" se llama a `onAgregar({vista:"frente", x:0.5, y:0.25, tipo:"golpe", nota:null})`.
  - Un clic en (105%, -3%) llama a `onAgregar` con `x:1, y:0` (punto 5 del Review Focus).
  - En solo lectura, el clic no abre nada.
  - Cada pin tiene `aria-label` "Daño 2: golpe, frente".
  - `ListaDanos` muestra "1. Golpe – Frente · pantalla" y, con `mostrarAutor`, el autor y la fecha.
  - Los pins de recepción muestran el ícono de candado y la leyenda "Firmado por el cliente".
  - Los botones del selector tienen `min-h-11`.

- [ ] **Step 2: Run to verify they fail.**
  Run: `npx vitest run components/ordenes/danos/__tests__/diagrama-danos.test.tsx`

- [ ] **Step 3: Implement**
  - SVG con `viewBox` del catálogo y trazos en `stroke="currentColor"`.
  - Los pins son círculos numerados posicionados en `x*viewBoxW` y `y*viewBoxH`.
  - El selector usa el `Sheet` de shadcn (con `side="bottom"`) en pantallas chicas y el `Popover` en `md:` y más grandes, según los componentes de `components/ui` que ya existan.

- [ ] **Step 4: Run tests.** Expected: PASS.

- [ ] **Step 5: Commit** `feat(ordenes): componentes del diagrama de daños`

---

### Task 8: Sección "Estado físico" en la recepción

**Files:**
- Create: `components/ordenes/danos/estado-fisico-recepcion.tsx`
- Modify: `components/ordenes/orden-form.tsx` (entre `AccesoriosPicker` en la línea 2003 y `FotosIngreso` en la línea 2043; borrador en las líneas 163-180 y 391-400; envío en la línea 1165)
- Test: `__tests__/components/orden-form-estado-fisico.test.tsx`

**Interfaces:**
- Consumes: las tareas 2, 3 y 7, y `danosRecepcionObligatorio` de `/api/configuracion/operativa` (tarea 4).
- Produces:
  ```tsx
  <EstadoFisicoRecepcion codigoTipo: string | null; valor: { danos: DanoInput[]; sinDanos: boolean };
                         onChange: (v: { danos: DanoInput[]; sinDanos: boolean }) => void; obligatorio: boolean; error?: string />
  ```
  El borrador suma `estadoFisico: { danos: DanoInput[]; sinDanos: boolean }`.

- [ ] **Step 1: Write the failing tests:**
  - Con un pin marcado, el botón "Sin daños visibles" queda `disabled`.
  - Con "Sin daños visibles" activo, el diagrama no acepta clics y se ve el texto "Sin daños visibles al ingreso".
  - Con la organización en obligatorio y nada marcado, al enviar se ve "Marcá el estado físico del equipo o indicá «Sin daños visibles»" y no se hace el fetch.
  - Al cambiar el tipo de equipo con pins marcados, aparece la confirmación "Cambiar el tipo de equipo borra los daños marcados". Si se confirma, quedan 0 pins; si se cancela, el tipo no cambia (punto 1 del Review Focus).
  - Un borrador con `estadoFisico.danos` de forma inválida, o con un diagrama que no corresponde al tipo, se restaura sin pins y sin error (punto 3 del Review Focus).
  - El envío incluye `danos` (sin `numero`) y `recepcionSinDanos`.

- [ ] **Step 2: Run to verify they fail.**
  Run: `npx vitest run __tests__/components/orden-form-estado-fisico.test.tsx`

- [ ] **Step 3: Implement** el componente contenedor y la integración en `orden-form`:
  - Estado nuevo `estadoFisico`.
  - Validación junto a `checklistItemFaltante`.
  - Saneamiento del borrador con `danoInputSchema.safeParse` por ítem, más `validarDanosParaTipo`.
  - Si la respuesta de la API trae `estadoFisicoGuardado:false`, se muestra un toast "La orden se creó, pero el estado físico no se pudo guardar".

- [ ] **Step 4: Run tests,** más las pruebas existentes del formulario. Expected: PASS.
  Run: `npx vitest run __tests__/components/orden-form`

- [ ] **Step 5: Commit** `feat(ordenes): estado físico en la recepción`

---

### Task 9: Tarjeta "Estado físico" en el detalle de la orden

**Files:**
- Create: `components/ordenes/danos/estado-fisico-card.tsx`
- Modify: `components/ordenes/orden-detail.tsx` (montarla antes de las pestañas de la línea 1254)
- Test: `__tests__/components/estado-fisico-card.test.tsx`

**Interfaces:**
- Consumes: `GET`, `POST` y `DELETE` de `/api/ordenes/[id]/danos` (tarea 6), y los componentes de la tarea 7.
- Produces: `<EstadoFisicoCard ordenId: string; puedeAgregar: boolean />`. `puedeAgregar` sale de los permisos ya cargados en el detalle (`reparar`) y del estado de la orden, que no puede estar entre `ESTADOS_SIN_NUEVOS_DANOS`.

- [ ] **Step 1: Write the failing tests:**
  - Se ven 2 grupos: "Al recibir" (con candado) y "Detectados en diagnóstico" (con autor y fecha).
  - Con `sinDanos`, se ve "Sin daños visibles al ingreso".
  - El botón "Agregar daño detectado" hace POST y suma el pin a la lista.
  - El botón para borrar solo aparece en pins de diagnóstico de menos de 10 minutos (con el reloj mockeado).
  - Un 409 muestra el `error` del servidor en un toast.
  - Con `puedeAgregar=false` no se ve el botón para agregar.
  - Una orden sin pins y sin `sinDanos` muestra "No se registró el estado físico al recibir el equipo", junto al botón para agregar si está permitido.

- [ ] **Step 2: Run to verify they fail.**
  Run: `npx vitest run __tests__/components/estado-fisico-card.test.tsx`

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run tests.** Expected: PASS.

- [ ] **Step 5: Commit** `feat(ordenes): tarjeta de estado físico en el detalle`

---

### Task 10: Seguimiento público

**Files:**
- Create: `app/api/public/ordenes/[token]/danos/route.ts`
- Modify: `components/seguimiento/seguimiento-content.tsx` (fetch junto a los de las líneas 279-289, y la sección de solo lectura)
- Test: `__tests__/api/public-ordenes-danos.test.ts`, `__tests__/components/seguimiento-estado-fisico.test.tsx`

**Interfaces:**
- Consumes: `listarDanosOrden(..., { incluirAutor: false })` (tarea 6). La resolución del token es la misma de `app/api/public/ordenes/[token]/photos/route.ts`, con su rate limit.
- Produces: `GET /api/public/ordenes/[token]/danos` devuelve `{ danos: Omit<DanoOrden,"createdByNombre">[]; sinDanos; diagrama }`.

- [ ] **Step 1: Write the failing tests:**
  - Un token inválido da 404.
  - La respuesta no tiene `createdByNombre` ni `created_by` en ningún pin (con `JSON.stringify` de la respuesta).
  - En el componente, un pin de diagnóstico dice "Detectado por el técnico".
  - Sin pins y sin `sinDanos`, la sección no se renderiza.

- [ ] **Step 2: Run to verify they fail.**
  Run: `npx vitest run __tests__/api/public-ordenes-danos.test.ts __tests__/components/seguimiento-estado-fisico.test.tsx`

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run tests.** Expected: PASS.

- [ ] **Step 5: Commit** `feat(seguimiento): estado físico del equipo en el seguimiento público`

---

### Task 11: PDF de la orden y ticket térmico

**Files:**
- Create: `lib/pdf-estado-fisico.ts`
- Modify: `lib/pdf.ts` (`OrdenPDFData` en la línea 965 suma `estadoFisico?`; `generateOrdenPDF` en la línea 1058 dibuja el bloque antes de la firma)
- Modify: `app/api/ordenes/[id]/pdf/route.ts` y `app/api/public/ordenes/[token]/pdf/route.ts` (cargar los daños con `listarDanosOrden`)
- Modify: `components/ordenes/thermal-print-recepcion.tsx` (suma la lista de texto después de "Accesorios", en la línea 271), y quien le pasa las props
- Test: `lib/__tests__/pdf-estado-fisico.test.ts`

**Interfaces:**
- Consumes: `diagramaPorRef` (tarea 2), `TIPO_DANO_META` (tarea 3) y `listarDanosOrden` (tarea 6).
- Produces:
  ```ts
  export interface EstadoFisicoPDF { diagrama: string; sinDanos: boolean; danos: Pick<DanoOrden,"numero"|"vista"|"x"|"y"|"tipo"|"nota"|"momento">[] }
  export function lineasEstadoFisico(e: EstadoFisicoPDF, momento: "recepcion" | "diagnostico"): string[]   // "1. Golpe (frente) – nota"
  export function dibujarEstadoFisico(page: PDFPage, e: EstadoFisicoPDF, box: { x: number; y: number; w: number }, fonts: { regular: PDFFont; bold: PDFFont }): number  // devuelve la altura usada
  ```

- [ ] **Step 1: Write the failing tests:**
  - `lineasEstadoFisico` con 2 pins de recepción y 1 de diagnóstico, con momento `recepcion`, devuelve 2 líneas con el formato exacto "1. Golpe (frente) – pantalla".
  - Con `sinDanos:true`, devuelve `["Sin daños visibles al ingreso"]`.
  - Generar un PDF de prueba con `pdf-lib` y llamar a `dibujarEstadoFisico` con una nota de 200 caracteres sin espacios y emojis no tira error, y la altura devuelta es mayor que 0 y menor que 400 (punto 4 del Review Focus).
  - Con un diagrama desconocido (`"xx@9"`) dibuja el genérico sin error.
  - Snapshot del texto del PDF con `pdf-parse`, si ya está en el proyecto; si no, solo la altura y que no haya error. Contiene "Estado físico al ingreso" y, si hay pins de diagnóstico, "Detectados en diagnóstico".

- [ ] **Step 2: Run to verify they fail.**
  Run: `npx vitest run lib/__tests__/pdf-estado-fisico.test.ts`

- [ ] **Step 3: Implement**
  - Las vistas se dibujan una al lado de la otra con `page.drawSvgPath(path, { x, y, scale, borderColor, borderWidth })`.
  - Los pins son círculos con el número y el color `pdfRgb` del tipo.
  - La lista va a la derecha, cortada con `wrapPdfTexto` (`lib/pdf.ts:2967`). Los caracteres que la fuente no tiene se reemplazan como ya hace `safe()`.
  - En el ticket térmico, solo `lineasEstadoFisico`.

- [ ] **Step 4: Run tests,** y además las pruebas existentes del PDF. Expected: PASS.
  Run: `npx vitest run lib/__tests__ __tests__/api/ordenes-pdf`

- [ ] **Step 5: Commit** `feat(pdf): estado físico en el PDF de la orden y en el ticket`

---

### Task 12: E2E y verificación final

**Files:**
- Create: `e2e/diagrama-danos.spec.ts`

- [ ] **Step 1: Write the E2E**, con el login y los fixtures de las specs existentes en `e2e/`:
  1. Crear una orden de un celular, tocar el frente dos veces y elegir "Golpe" y "Rayón".
  2. Abrir el detalle: los 2 pins aparecen con candado.
  3. Agregar un daño detectado ("Humedad", en el dorso): aparece con el autor.
  4. Abrir `/seguimiento/<token>`: se ven los 3 pins y "Detectado por el técnico".

- [ ] **Step 2: Run** `npx playwright test e2e/diagrama-danos.spec.ts`. Expected: PASS. Requiere la migración 408 aplicada en la base de prueba. Si la base de E2E es la de producción (ver la memoria `stapp-maquina-linux-setup`), **no correrla**: dejar la spec escrita y avisar.

- [ ] **Step 3: Verificación completa**
  Run: `npx tsc --noEmit` (con `NODE_OPTIONS=--max-old-space-size=8192`), `npm run lint` y `npx vitest run`.
  Expected: sin errores.

- [ ] **Step 4: Commit** `test(e2e): diagrama de daños de punta a punta`
