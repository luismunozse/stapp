# Diagrama de daños en la recepción — Diseño

Fecha: 2026-11-12
Estado: diseño aprobado por partes en la conversación del 2026-11-12. Spec pendiente de revisión del usuario.
Origen: comparación con Gestioo ("Diagramas y anotaciones": marcado visual sobre un esquema del equipo). STApp no tiene nada equivalente.

## Objetivo

Que al recibir un equipo el vendedor marque **sobre un dibujo del equipo** dónde están los daños (rayones, golpes, roturas), y que eso quede:

- firmado por el cliente junto con el resto de la recepción,
- impreso en el comprobante,
- visible en el seguimiento público.

**Para qué:** dejar constancia del estado físico al ingreso y evitar discusiones en la entrega ("eso ya venía así"). Además es un diferencial que se ve en una demo.

**Criterio de éxito:**
- Un vendedor marca 2 o 3 daños en menos de 15 segundos, desde el celular y con una mano.
- Los daños de la recepción quedan inalterables una vez creada la orden.

## Decisiones tomadas (con el usuario)

| # | Pregunta | Decisión |
|---|----------|----------|
| 1 | ¿Qué equipos tienen dibujo? | **B**: todos los electrónicos base (celular, tablet, computadora, consola, smartwatch, impresora), cada uno con su dibujo, y un dibujo **genérico** para los tipos personalizados. |
| 2 | ¿Cómo se marca? | **A**: tocar un punto y elegir el tipo de daño, con nota opcional. Pin numerado con color por tipo, más una lista debajo. |
| 3 | ¿Qué pasa después de la recepción? | **B**: los pins de la recepción quedan **bloqueados**. El técnico puede sumar pins nuevos, marcados como "detectado en diagnóstico" con autor y fecha. |
| 4 | ¿Es obligatorio? | **C**: lo configura cada taller. Por defecto es opcional. El botón "Sin daños visibles" existe siempre. |
| 5 | ¿Cómo se guarda? | Tabla `orden_danos`, una fila por pin. Dibujos SVG versionados en el código. Bloqueo garantizado por triggers en la base. |

## Situación actual (medida en el código)

- **Recepción:** `components/ordenes/orden-form.tsx` ya tiene accesorios (`AccesoriosPicker`), fotos (`FotosIngreso`), un checklist con firma de conformidad (`checklist_recepcion`, una fila por orden) y un borrador local del formulario.
- **Tipo de equipo:** `ordenes_servicio.tipo_dispositivo_id` apunta a `tipos_dispositivo` (`codigo`, `es_base`). Los códigos base están en `lib/tipos-dispositivo-defaults.ts`.
- **PDF de la orden:** se arma con `pdf-lib` en `lib/pdf.ts`. Lo sirven `app/api/ordenes/[id]/pdf` y la ruta pública `app/api/public/ordenes/[token]/pdf`.
- **Seguimiento público:** `app/seguimiento/[token]/page.tsx`.
- **Fotos de la orden:** tabla `fotos_orden` (`id`, `orden_id`, `url`, `storage_path`, `tipo`).

## Modelo de datos (migración 408)

### Tabla `orden_danos`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | TEXT PK | `generate_cuid()` |
| `organization_id` | TEXT NOT NULL | FK a organizations, límite del tenant |
| `orden_id` | TEXT NOT NULL | FK a `ordenes_servicio`, `ON DELETE CASCADE` |
| `numero` | INT NOT NULL | Correlativo dentro de la orden (1, 2, 3…). Único por orden. |
| `diagrama` | TEXT NOT NULL | Dibujo y versión con que se marcó, por ejemplo `celular@1` |
| `vista` | TEXT NOT NULL | `frente`, `dorso` o `lateral`. Tiene que existir en ese diagrama (lo valida la API). |
| `x`, `y` | NUMERIC(5,4) NOT NULL | Posición relativa, entre 0 y 1 (CHECK) |
| `tipo` | TEXT NOT NULL | CHECK: `rayon`, `golpe`, `rotura`, `faltante`, `humedad`, `otro` |
| `nota` | TEXT NULL | Hasta 200 caracteres (CHECK) |
| `momento` | TEXT NOT NULL | CHECK: `recepcion` o `diagnostico` |
| `created_by` | TEXT NULL | FK a users, `ON DELETE SET NULL` |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |

Índices: `(orden_id)` y `UNIQUE (orden_id, numero)`.

### Otras columnas

- `ordenes_servicio.recepcion_sin_danos BOOLEAN NOT NULL DEFAULT false`
- `organizations.danos_recepcion_obligatorio BOOLEAN NOT NULL DEFAULT false`

### Reglas en la base (triggers)

1. **Recepción inalterable.** Las filas con `momento = 'recepcion'` no admiten UPDATE ni DELETE, salvo el borrado en cascada de la orden.
2. **La recepción se carga una sola vez, al crear la orden.** `POST /api/ordenes` hoy inserta la orden con un `insert` y después guarda fotos y eventos en llamadas separadas, sin transacción. Por eso la recepción se guarda con una función RPC atómica, `registrar_estado_fisico_recepcion(p_orden_id, p_danos jsonb, p_sin_danos boolean)`, que inserta todos los pins y la marca de sin daños juntos, o nada. La función rechaza la llamada si:
   - la orden ya tiene pins `recepcion` o ya tiene `recepcion_sin_danos = true` (la recepción se registra una sola vez);
   - la orden se creó hace más de 10 minutos;
   - la orden es de otra organización.

   Un trigger impide insertar pins `recepcion` por fuera de esa función (la función activa una variable de sesión, `set_config('stapp.danos_recepcion', 'on', true)`, que el trigger verifica).
3. **Diagnóstico corregible por 10 minutos.** Un pin `diagnostico` se puede borrar solo si `now() - created_at < 10 min`. No admite UPDATE.
4. **Orden cerrada.** No se insertan pins si la orden está entregada o cancelada; se usan los estados de `lib/orden-state-machine.ts`.
5. **Sin daños o con pins, nunca las dos cosas.** Si `recepcion_sin_danos = true`, no puede haber pins `recepcion`, y al revés.
6. **`numero`** lo asigna un trigger como `max(numero) + 1` por orden, con `FOR UPDATE` sobre la orden para no duplicarlo si dos personas agregan a la vez.

### Acceso

- RLS por `organization_id`, igual que el resto de las tablas. Los técnicos ven los pins de las órdenes que ya pueden ver.
- El seguimiento público lee los pins del lado del servidor, a partir del token de la orden. No expone `created_by`.

### Verificación

- `supabase/migrations/verify/408_probes.sql`: consultas para cada regla de arriba.
- `supabase/migrations/rollback/408_rollback.sql`

## Catálogo de dibujos

`components/ordenes/danos/diagramas.ts` es un módulo de datos puro, sin React, compartido entre la pantalla y el PDF.

```ts
interface Diagrama {
  id: string            // "celular"
  version: number       // 1
  vistas: { id: "frente" | "dorso" | "lateral"; label: string; viewBox: string; paths: string[] }[]
}
resolverDiagrama(codigoTipo: string | null): Diagrama          // código base → su dibujo; cualquier otro → "generico"
diagramaPorRef(ref: string): Diagrama                           // "celular@1" → ese dibujo; desconocido → genérico
```

- Dibujos v1: celular, tablet, computadora (notebook abierta), consola (joystick y equipo), smartwatch, impresora, y genérico (rectángulo con frente y dorso).
- Son trazos de línea simples, sin rellenos, con color `currentColor` para que funcionen en modo claro y oscuro.
- **Regla de versionado:** cambiar un dibujo existente obliga a subir la versión y dejar la anterior en el catálogo. Las órdenes viejas se siguen dibujando con su versión.
- `resolverDiagrama` es el **único punto de entrada** al catálogo. Ahí se van a enchufar los dibujos subidos por cada taller (ver Fases siguientes).

## Interfaz

Componentes en `components/ordenes/danos/`:

- **`DiagramaDanos`**: el dibujo con sus pins numerados y coloreados por tipo. Tiene modo de edición y de solo lectura. Las vistas se eligen con pestañas para que en el celular el dibujo ocupe todo el ancho.
- **`SelectorTipoDano`**: se abre al tocar el dibujo. En el celular es una hoja que sube desde abajo, en la computadora un menú chico. Trae 6 botones de al menos 44 px con ícono y color. Un toque agrega el pin; la nota se puede escribir después.
- **`ListaDanos`**: la lista "1. Golpe – Frente · nota". Tocar un ítem resalta su pin. Mientras se crea la orden permite quitar pins.

Pantallas:

- **Recepción (`orden-form`).** Sección "Estado físico" entre accesorios y fotos, con el dibujo y el botón **"Sin daños visibles"**, que se desactiva cuando hay pins. Los pins se guardan en el borrador del formulario que ya existe. Si el taller lo exige, se valida igual que los ítems faltantes del checklist.
- **Detalle de la orden.** Tarjeta "Estado físico" con los pins de recepción (candado, "firmado por el cliente") y los de diagnóstico (otro color, autor y fecha). Botón **"Agregar daño detectado"** que agrega solo pins de diagnóstico. Mientras corre la ventana de 10 minutos, permite borrar un pin de diagnóstico.
- **Seguimiento público.** Vista de solo lectura. Los pins de diagnóstico dicen "Detectado por el técnico", sin nombres de empleados.
- **Configuración.** Interruptor "Exigir estado físico al recibir un equipo".

Accesibilidad: los pins tienen etiqueta (`aria-label` "Daño 2: golpe, frente"), la lista es la alternativa textual del dibujo y los colores no son la única forma de distinguir el tipo, porque también llevan ícono.

## API

- **`POST /api/ordenes`** (existente) acepta `danos[]` y `recepcionSinDanos`. Valida todo **antes** de insertar la orden. Después de insertarla llama a `registrar_estado_fisico_recepcion`. Si esa llamada falla y el taller exige el estado físico, borra la orden recién creada (compensación) y responde con el error, para no dejar una orden obligatoria sin su estado físico. Si no lo exige, la orden queda y la respuesta avisa que el estado físico no se guardó. Validación zod: coordenadas entre 0 y 1, tipo válido, diagrama que corresponda al tipo de equipo, vista existente, hasta 30 pins. Si el taller exige el estado físico y no hay pins ni "sin daños", responde 422.
- **`GET /api/ordenes/[id]/danos`**: lista de pins.
- **`POST /api/ordenes/[id]/danos`**: agrega un pin de diagnóstico.
- **`DELETE /api/ordenes/[id]/danos/[danoId]`**: borra un pin de diagnóstico dentro de los 10 minutos.
- Errores: orden cerrada → 409 "La orden ya está cerrada". Ventana vencida → 409. Los rechazos de los triggers se traducen con `lib/rpc-errors.ts`.

## Impresión

- **PDF A4 (`lib/pdf.ts`).** Bloque "Estado físico al ingreso" antes de la firma, con las vistas una al lado de la otra (`drawSvgPath`), los pins numerados y la lista al costado. Con "sin daños", una sola línea: "Sin daños visibles al ingreso". Si al reimprimir la orden ya tiene pins de diagnóstico, se agrega un bloque aparte, "Detectados en diagnóstico".
- **Ticket térmico (58 y 80 mm).** Solo la lista de texto, porque el dibujo no se lee a ese tamaño.
- **Diagrama desconocido:** se dibuja sobre el genérico. Nunca rompe el PDF.

## Pruebas

- **Base de datos:** `verify/408_probes.sql` (recepción inalterable, ventana de 10 minutos, exclusión con "sin daños", orden cerrada, RLS entre organizaciones, `numero` sin duplicados).
- **Unitarias (vitest):** validador zod, catálogo (todo código base tiene dibujo, genérico de reserva, `diagramaPorRef` con una versión vieja o desconocida) y el armado del bloque del PDF.
- **Componentes:** agregar un pin con un toque, "Sin daños visibles" desactivado cuando hay pins, validación cuando es obligatorio, solo lectura en el detalle.
- **E2E (Playwright):** crear una orden con 2 pins, ver el detalle con la recepción bloqueada, agregar un pin de diagnóstico y verlo en el seguimiento.

## Fuera de alcance en v1

Imágenes subidas por cada taller, estadísticas de daños y fotos vinculadas a un pin. **No se descartan: son las próximas fases** y están desarrolladas abajo. El diseño de v1 está pensado para que cada una se sume sin migrar datos ni cambiar lo existente.

## Fases siguientes

### Fase 2: fotos vinculadas a un pin

**Qué es:** desde un pin, sacar o elegir una o más fotos de ese daño puntual. En el detalle, el seguimiento y el PDF, el pin muestra sus fotos.

**Por qué importa:**
- Es la prueba más fuerte ante un reclamo: el pin dice dónde está el daño y la foto muestra cómo era.
- Hoy las fotos de ingreso son sueltas y no queda claro a qué daño corresponde cada una.

**Cómo se construye sobre v1:**
- Tabla puente `orden_danos_fotos (dano_id, foto_id)` hacia la tabla existente `fotos_orden`, que permite varias fotos por pin. Es una migración aditiva: no cambia `orden_danos`.
- La regla de inmutabilidad se extiende: las fotos de un pin `recepcion` se vinculan al crear la orden y después no se desvinculan.
- En la interfaz, la hoja de `SelectorTipoDano` suma un botón "Agregar foto" que reutiliza `FotosIngreso` y su compresión de imágenes.
- En el PDF, una miniatura por pin, si entra en el bloque, o un anexo de fotos.

**Decisiones de v1 que la dejan preparada:** los pins tienen `id` estable y son filas propias, no un JSON, así que se pueden referenciar desde otra tabla. Las fotos ya viven en `fotos_orden` con storage privado.

### Fase 3: estadísticas de daños

**Qué es:** reportes sobre los daños registrados.

**Por qué importa:**
- **Daños más comunes por marca o modelo:** ayuda a decidir qué repuestos tener en stock y qué servicios ofrecer.
- **Porcentaje de equipos que ingresan con daños:** un indicador de riesgo de reclamos.
- **Daños detectados en diagnóstico por vendedor que hizo la recepción:** muestra si la recepción en el mostrador está siendo prolija, porque cada daño que aparece recién en diagnóstico es uno que no se vio al recibir.
- Responde a "Nivel de satisfacción y estadísticas" de Gestioo con un dato que ellos no tienen.

**Cómo se construye sobre v1:**
- Los datos ya están estructurados: `tipo` es una lista cerrada, y además están `momento`, `created_at` y `created_by`. Con un JOIN a la orden se obtienen marca, modelo, tipo de equipo y sucursal.
- Se suma como una sección en `reportes-avanzados` (plan Profesional), siguiendo el patrón de los reportes existentes.
- Índice nuevo `(organization_id, created_at)` en `orden_danos`, que se crea en esta fase y no en v1 porque v1 no lo necesita.
- Puede sumar herramientas al asistente ("¿qué daños son más comunes en los Samsung?"), en línea con `2026-11-12-asistente-datos-fase1-design.md`.

**Decisiones de v1 que la dejan preparada:** `tipo` como lista cerrada (CHECK) en lugar de texto libre, y `momento` y `created_by` en cada pin.

### Fase 4: dibujos propios de cada taller

**Qué es:** que cada taller suba su propia imagen (foto o esquema) para cualquier tipo de equipo, con una o más vistas, y marque los daños sobre ella.

**Por qué importa:**
- Hace que la función sirva para todos los rubros de STApp (automotor, motos y bicicletas, electrodomésticos, relojería), donde un dibujo genérico no alcanza. Gestioo lo ofrece "por tipo de equipo o vehículo".
- Permite a un taller usar el esquema del modelo exacto que más repara.

**Cómo se construye sobre v1:**
- Una tabla nueva `diagramas_personalizados` (`organization_id`, `tipo_dispositivo_id`, `version`, vistas con `storage_path` de cada imagen), en un bucket privado como los demás.
- `resolverDiagrama` busca primero un dibujo propio para el tipo y, si no hay, usa el del catálogo. Es el único punto de entrada, así que no se toca nada más.
- `orden_danos.diagrama` ya es texto libre: los propios se guardan como `org:<id>@<version>`. Las coordenadas relativas (0 a 1) sirven igual sobre una imagen.
- En el PDF, la vista se inserta como imagen (`embedPng` o `embedJpg`) en lugar de trazos SVG.
- Reemplazar la imagen de un taller crea una versión nueva. Las órdenes viejas mantienen la suya, con la misma regla de versionado que el catálogo.

**Decisiones de v1 que la dejan preparada:** `diagrama` como texto con versión, coordenadas relativas, el único punto de entrada `resolverDiagrama`, y el fallback a genérico ante una referencia desconocida.

**A definir en su propio spec:** el editor de vistas (recorte, rotación), el límite de tamaño y cantidad por plan, y qué pasa si se borra el tipo de equipo.

### Orden de las fases

Las fases están numeradas en el orden en que conviene hacerlas:

1. **Fase 2, fotos por pin:** la de mayor valor como prueba ante reclamos y la más barata.
2. **Fase 3, estadísticas:** conviene esperar a que v1 acumule datos.
3. **Fase 4, dibujos propios:** la más grande; abre la función a los demás rubros.
