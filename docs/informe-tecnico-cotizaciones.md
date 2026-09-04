# Informe técnico para seguros (cotizaciones)

Fecha: 2026-09-04
Estado: diseño aprobado. Plan de implementación en `docs/informe-tecnico-cotizaciones-plan.md`

## 1. Problema

Los talleres que trabajan con compañías de seguro necesitan emitir un documento
que acredite que un técnico revisó el equipo y dictaminó si tiene o no
reparación.

Hoy el sistema sólo sabe emitir presupuestos: `app/api/cotizaciones/route.ts:61`
exige `items: z.array(itemSchema).min(1, "Debe tener al menos un item")`. Cuando
el equipo es irreparable no hay ítems que cargar, y el flujo entero queda
bloqueado. El taller no tiene forma de emitir el dictamen.

Cuando el equipo sí es reparable, el presupuesto actual ya sirve para informar el
costo, pero no tiene dónde asentar el diagnóstico ni la causa del daño, que es lo
que la aseguradora necesita para decidir la cobertura.

Un tercer caso, señalado por el usuario: el informe se emite a nombre del cliente
registrado, pero se presenta ante una entidad distinta (la aseguradora, una ART,
un juzgado). El documento debe decir ante quién se presenta.

## 2. Decisiones tomadas

| Decisión | Elección | Descartado |
|---|---|---|
| Modelo de datos | Cotización sin ítems, misma tabla | Tabla `informes_tecnicos` propia; campo suelto en la orden |
| Contenido del dictamen | Veredicto + diagnóstico + causa | Sumar valuación económica; sumar firma y matrícula del técnico |
| Alcance de los campos | Opcionales siempre, obligatorios si hay 0 ítems | Sólo cuando no hay ítems; obligatorios siempre |
| Entidad destinataria | Texto libre con autocompletado de lo ya usado | Texto libre suelto; ABM de entidades por organización |

La valuación económica (costo de reparación vs. valor de reposición) y la firma
con matrícula quedan explícitamente fuera de alcance. Ver §11.

## 3. Modelo de datos

Migración nueva, cuatro columnas en `cotizaciones`. Sin tablas nuevas.

```sql
ALTER TABLE cotizaciones
  ADD COLUMN veredicto            TEXT,
  ADD COLUMN diagnostico_tecnico  TEXT,
  ADD COLUMN causa_dano           TEXT,
  ADD COLUMN presentado_ante      TEXT;

ALTER TABLE cotizaciones ADD CONSTRAINT cotizaciones_veredicto_check
  CHECK (veredicto IS NULL OR veredicto IN ('REPARABLE','IRREPARABLE','SIN_FALLA'));

ALTER TABLE cotizaciones ADD CONSTRAINT cotizaciones_causa_dano_check
  CHECK (causa_dano IS NULL OR causa_dano IN
    ('CAIDA','LIQUIDO','SOBRETENSION','DESGASTE','USO_INDEBIDO','FALLA_FABRICA','DESCONOCIDA'));
```

Numeración: la migración más alta **en `main`** es la
`321_email_delivery_tracking.sql`, pero el **322 ya está tomado** por
`322_tecnicos_cobran_cotizaciones.sql` en la rama sin mergear
`feat/tecnicos-cobran-cotizaciones`. El número libre es el **323**.

El número definitivo se confirma **al mergear, no al crear la rama**. Antes de
abrir el PR, volver a correr:

```bash
git log --all --diff-filter=A --name-only --pretty=format: -- 'supabase/migrations/32*' \
  | rg -v '^$' - | sort -u
```

Si para entonces `feat/tecnicos-cobran-cotizaciones` sigue sin mergear, renumerar
esta migración por encima de la más alta ya aplicada. Dejar huecos está
permitido; lo que no se puede es aplicar un número por debajo de uno ya aplicado.

### 3.1 Por qué no se toca `tipo`

`cotizaciones.tipo` ya existe (migración 126) con `CHECK ('ORDEN','PRESUPUESTO')`.
Responde una pregunta distinta: si el documento cuelga de una orden de trabajo o
vuela solo con snapshot de equipo y checklist. Es ortogonal al veredicto —
un informe irreparable puede ser `ORDEN` (el equipo está en el taller) o
`PRESUPUESTO` (peritaje suelto). Agregar `'INFORME'` como tercer valor mezclaría
dos ejes y obligaría a productos cruzados imposibles de expresar.

El informe no es un tipo: es la consecuencia de un veredicto que no admite ítems.

### 3.2 Por qué la columna se llama `diagnostico_tecnico` y no `diagnostico`

El nombre corto **ya está tomado**. `condicionesSchema` (`app/api/cotizaciones/route.ts:27`)
tiene un campo `diagnostico` que se guarda dentro del JSONB `equipo_snapshot`
—y **sólo** para `tipo = 'PRESUPUESTO'`, así que en una cotización colgada de
una orden ese JSONB es `null`. Son dos campos distintos con dos alcances
distintos; reusar el nombre los condena a que alguien los fusione.

`ordenes_servicio.diagnostico TEXT` también existe
(`supabase/migrations/001_schema.sql:199`). La cotización guarda igual su propia
copia, por dos razones:

1. El diagnóstico de la orden sigue mutando después de emitido el documento. Un
   informe presentado ante una aseguradora no puede cambiar a espaldas de nadie.
2. Una cotización puede ser standalone (`orden_id IS NULL` desde la migración
   052), y entonces no hay orden de la cual leer.

El formulario **precarga** el campo desde la orden cuando existe, para no obligar
a tipear dos veces. Lo que se persiste es la copia congelada.

### 3.3 Autocompletado de `presentado_ante`

Endpoint nuevo `GET /api/cotizaciones/entidades` → `{ entidades: string[] }`.

Semánticamente es esto:

```sql
SELECT DISTINCT presentado_ante
FROM cotizaciones
WHERE organization_id = $1
  AND presentado_ante IS NOT NULL
  AND deleted_at IS NULL
ORDER BY 1
```

**Pero PostgREST no expone `SELECT DISTINCT`.** La ruta trae hasta 500 filas de
la columna y deduplica en JavaScript. El límite acota el costo: un taller no
trabaja con 500 aseguradoras, y si alguna quedara afuera el campo sigue siendo
escribible a mano. Un índice parcial sobre `(organization_id, presentado_ante)`
evita el scan completo.

Alimenta un `<datalist>` en el formulario. Sin tabla, sin ABM. Evita que la
misma aseguradora quede escrita de cinco formas distintas sin obligar a nadie a
dar de alta nada.

Guard: `requireAuth()` + scope por `organization_id`. Devuelve sólo strings.

## 4. Reglas de validación

El `.min(1)` de `app/api/cotizaciones/route.ts:61` se reemplaza por una función
pura, `validarInforme`, en un módulo compartido (`lib/cotizacion-informe.ts`).

| Ítems | Veredicto | Resultado |
|---|---|---|
| ≥ 1 | cualquiera, o ausente | Válido (comportamiento actual, sin cambios) |
| 0 | `IRREPARABLE` o `SIN_FALLA` | Válido, pero `diagnostico_tecnico` y `causa_dano` pasan a obligatorios |
| 0 | ausente | Rechazado: `"Una cotización sin ítems necesita un veredicto técnico"` |
| 0 | `REPARABLE` | Rechazado: `"Si el equipo es reparable, el presupuesto necesita al menos un ítem"` |

`diagnostico_tecnico` obligatorio significa no vacío después de `trim()`.

**Por qué una función pura y no un `superRefine` en los dos schemas.** El POST
recibe el documento entero y puede validar el payload: ahí `validarInforme` se
envuelve en un `superRefine`. El PUT no: arma su `updateData` campo por campo, y
un pedido puede cambiar el veredicto **sin mandar `items`**. Un refine sólo ve el
payload y no podría distinguir "no mandó ítems" de "no tiene ítems". Por eso el
PUT llama a la misma función después de fusionar el payload con la fila
existente, y valida el estado **resultante**.

Los totales (`subtotal`, `iva`, `total`) son `NOT NULL` desde la migración 001 y
quedan en `0` para un informe sin ítems. No requieren cambio de esquema.

### 4.1 Limitación conocida y aceptada

Esta regla **no puede expresarse como CHECK en la base**, porque depende del
conteo de filas de `items_cotizacion`, una tabla distinta. Expresarla en la base
requeriría un trigger `AFTER INSERT OR DELETE` sobre `items_cotizacion` más otro
sobre `cotizaciones`, con el riesgo de orden de operaciones dentro de la misma
transacción.

Se enforcea en la capa de API. Un `INSERT` directo por SQL puede violarla. Es una
concesión deliberada: el resto del dominio de cotizaciones ya valida así.

## 5. Máquina de estados

### 5.1 Estado de la cotización

`estado_cotizacion` sigue siendo `BORRADOR | ENVIADA | ACEPTADA | RECHAZADA`.
**No se agrega ningún valor.**

Un informe recorre `BORRADOR → ENVIADA` y ahí termina. `ENVIADA` es su estado
terminal: un informe se emite, no se acepta ni se rechaza. La vista pública deja
de ofrecer esas acciones (§7.1).

### 5.2 Estado de la orden vinculada

**Emitir un informe no cambia el estado de la orden.** La orden se queda donde
está hasta la entrega.

| Veredicto | Orden pasa a |
|---|---|
| `REPARABLE` (o ausente) | `PRESUPUESTADO` — comportamiento actual, sin cambios |
| `IRREPARABLE` | no se toca |
| `SIN_FALLA` | no se toca |

El motivo es físico, no técnico: cuando el técnico dictamina que el equipo es
irreparable, el equipo **sigue en el mostrador** esperando que el cliente lo
retire. Marcar la orden como `SIN_REPARACION` en ese momento adelanta un hecho
que todavía no ocurrió y le tapa al taller el estado real, que es el que necesita
para saber que tiene un equipo ahí esperando.

`estado_orden` ya tiene los estados terminales para este desenlace —
`SIN_REPARACION` (`supabase/migrations/005_update_estados_orden.sql:20`),
`SIN_FALLA_DETECTADA` (migración 262) y `ENTREGADO_SIN_REPARACION`
(migración 080)— pero los pone el flujo de entrega que ya existe, cuando el
cliente efectivamente retira. El informe no los toca.

Consecuencia: emitir el informe no deja rastro en la lista de órdenes. Ver §11.

### 5.3 Bug a evitar antes de escribirlo

Hoy hay **dos** puntos que empujan la orden a `PRESUPUESTADO` de forma
incondicional al pasar la cotización a `ENVIADA`:

- `app/api/cotizaciones/[id]/enviar/route.ts:172-199`
- `app/api/cotizaciones/[id]/route.ts:800-833` (la ruta PUT, que usa el botón
  "Enviar y compartir" de la lista, salteando el envío de mail)

Sin tocar los dos, emitir un informe irreparable dejaría la orden en
`PRESUPUESTADO`, esperando la respuesta a un presupuesto que no existe. Ambos
deben saltear la transición cuando el veredicto es `IRREPARABLE` o `SIN_FALLA`.

Que la transición se saltee en vez de redirigirse tiene un efecto secundario
bueno: `revertirOrdenSinPresupuestoActivo`
(`app/api/cotizaciones/[id]/route.ts:94-137`) sólo revierte desde
`PRESUPUESTADO`, así que al borrar o rechazar un informe no encuentra nada que
revertir y no hace nada. Es el comportamiento correcto sin escribir una línea.

## 6. API

| Ruta | Cambio |
|---|---|
| `POST /api/cotizaciones` | Reemplazar `.min(1)` por el `superRefine` de §4; aceptar los cuatro campos nuevos |
| `PUT /api/cotizaciones/[id]` | Mismo `superRefine`; aceptar los cuatro campos nuevos |
| `POST /api/cotizaciones/[id]/enviar` | Ramificar la transición de orden por veredicto (§5.2) |
| `PUT /api/cotizaciones/[id]` (transición a `ENVIADA`) | Misma ramificación |
| `GET /api/cotizaciones/entidades` | **Nueva.** Autocompletado de `presentado_ante` (§3.3) |
| `GET /api/cotizaciones/[id]` y variantes públicas | Exponer los cuatro campos nuevos en la respuesta |

El `superRefine` vive en un módulo compartido (`lib/cotizacion-validacion.ts` o
equivalente) para que POST y PUT no diverjan. Que la misma regla esté escrita dos
veces es precisamente cómo se rompen estas cosas.

## 7. Interfaz

### 7.1 Vista pública — `components/cotizaciones/cotizacion-publica.tsx`

Cuando el documento es un informe (0 ítems y veredicto presente), se ocultan:

- Botón Aprobar
- Botón Rechazar
- Captura de firma

Queda leer el dictamen y descargar el PDF. Las rutas públicas de aprobación y
rechazo deben además **rechazar del lado del servidor** una cotización sin ítems,
no sólo esconder el botón: hay tres caminos de aprobación distintos
(`public/cotizaciones/[token]/aprobar`, `public/ordenes/[token]/approve-cotizacion`,
y la interna `[id]/aprobar`) y esconder UI no cierra ninguno.

### 7.2 Formulario — `components/cotizaciones/cotizacion-form.tsx`

Bloque "Informe técnico" sobre la tabla de ítems:

- **Veredicto**: tres opciones excluyentes (Reparable / Irreparable / Sin falla detectada)
- **Diagnóstico técnico**: textarea, precargado desde `ordenes_servicio.diagnostico` si hay orden
- **Causa probable del daño**: select con los siete valores del CHECK
- **Para ser presentado ante**: input con `<datalist>` alimentado por `GET /api/cotizaciones/entidades`

Al elegir `IRREPARABLE` o `SIN_FALLA`, la tabla de ítems se colapsa con un aviso
explicando que el documento se emitirá como informe técnico sin presupuesto.

### 7.3 Selector de ítems — invertir el default

Hallazgo de la auditoría: la búsqueda de catálogo **ya existe y es mejor que la
de órdenes**. `components/cotizaciones/item-row.tsx:117-128` consulta
`/api/inventario/search` y `/api/servicios?buscar=` en paralelo y los fusiona en
un único desplegable tagueado `PRODUCTO`/`SERVICIO`. Órdenes, en cambio, tiene
dos pestañas separadas (`orden-repuestos-tab.tsx` y `orden-servicios-tab.tsx`).

El problema no es de capacidad sino de descubribilidad:

- `item-row.tsx:255-262` — la fila nace como input de texto libre ("Descripción del item")
- `item-row.tsx:264-266` — el buscador vive detrás de un botón ícono `Package` sin etiqueta

Cambio: **la fila nueva nace en modo búsqueda**, con placeholder "Buscar producto
o servicio…", y un enlace secundario "Escribir a mano" para caer a texto libre.
Sin cambios de API, sin migración.

Riesgo a cubrir con prueba manual: las cotizaciones existentes en `BORRADOR` se
editan con filas ya cargadas; esas filas deben seguir mostrando su descripción,
no abrir el buscador encima.

## 8. PDF

El PDF de cotizaciones se genera con **pdf-lib**, no con react-pdf:
`generateCotizacionPDF` en `lib/pdf.ts:199`. La hidratación de extras vive en
`buildCotizacionPdfExtras` (`lib/cotizacion-pdf.ts`), que ya ramifica por `tipo`
para la variante `PRESUPUESTO` y es compartida por las cuatro rutas que emiten
el documento (interna, envío por mail, pública, y JSON público).

Se agrega la variante informe:

Se agrega **un solo bloque**, "DICTAMEN TÉCNICO", justo antes de la tabla de
ítems: en un informe es el cuerpo del documento, y en un presupuesto con
dictamen es el encabezado del detalle. Contiene, cada uno si tiene valor:

- "Para ser presentado ante: {entidad}"
- Veredicto
- Causa probable del daño
- Diagnóstico (con corte de línea al ancho útil)

El bloque se dibuja si hay veredicto **o** hay entidad destinataria; con sólo
entidad, el rótulo pasa a "PRESENTACIÓN". La entidad va acá y no bajo los datos
del cliente para no editar quirúrgicamente el card del cliente, que es la parte
del layout con más coordenadas calculadas a mano.

El título y el cuerpo dependen sólo del conteo de ítems:

| Ítems | Título | Cuerpo |
|---|---|---|
| 0 | **INFORME TÉCNICO** | Bloque de dictamen. Sin tabla de ítems ni totales |
| ≥ 1, sin veredicto | COTIZACIÓN / PRESUPUESTO (como hoy) | Tabla y totales, sin cambios |
| ≥ 1, con veredicto | COTIZACIÓN / PRESUPUESTO | Bloque de dictamen **sobre** la tabla; tabla y totales se mantienen |

La tercera fila es un presupuesto con dictamen: el caso del equipo reparable que
igual necesita explicarle a la aseguradora qué le pasó.

## 9. Gating y permisos

Sin cambios. El informe entra por las mismas puertas que la cotización:
`hasPlanFeature(organizationId, "cotizaciones_online")`, plan Profesional en
adelante (la migración 266 lo sacó de Free).

El rol `TECNICO` ya está limitado a sus propias cotizaciones (`created_by`) en
las rutas de lectura y edición. Como el informe es literalmente el dictamen del
técnico, ese scope es el correcto y no se amplía.

## 10. Pruebas

Automatizadas:

1. `superRefine` — los cuatro casos de la tabla de §4.
2. Transición de orden por veredicto: enviar un informe `IRREPARABLE` deja la
   orden **en el estado que ya tenía**, no en `PRESUPUESTADO`. El test parte de
   una orden en `EN_DIAGNOSTICO` y afirma que sigue en `EN_DIAGNOSTICO`. Cubrir
   los **dos** caminos de envío (`/enviar` y el PUT).
3. Aprobación pública de un documento sin ítems: rechazada por los tres caminos.
4. PDF: un informe no dibuja tabla de ítems ni totales; un presupuesto con
   diagnóstico dibuja ambas cosas.

Manuales:

5. Editar una cotización `BORRADOR` preexistente: las filas cargadas muestran su
   descripción y no el buscador.
6. Emitir un informe irreparable end to end y verificar el PDF impreso.

## 11. Fuera de alcance

- Valuación económica (costo de reparación vs. valor de reposición del equipo)
- Firma y matrícula del técnico responsable en el pie del documento
- ABM de entidades / aseguradoras por organización
- Numeración propia con prefijo `INF-`. Se usa el mismo contador
  `numero_cotizacion`: un segundo contador por organización es un problema de
  concurrencia entero a cambio de un beneficio cosmético, y estos números ya son
  únicos por organización, no globales. Si una aseguradora exige un prefijo
  visible, se resuelve en el render del PDF sin tocar la base.
- Señalizar en la lista de órdenes cuáles ya tienen dictamen emitido y esperan
  que el cliente retire. Como el informe no cambia el estado de la orden (§5.2),
  esas órdenes se quedan en `EN_DIAGNOSTICO` mezcladas con las que todavía no se
  revisaron. Hoy el dato se ve entrando a la orden, en su pestaña de
  cotizaciones. Si al taller le molesta, se resuelve después con una columna o un
  filtro; no justifica ensuciar la máquina de estados ahora.
- Unificar el selector de ítems de órdenes con el de cotizaciones. Son contratos
  de API distintos (órdenes reserva stock y persiste por ítem; cotizaciones no
  reserva y persiste al guardar el documento entero). Fusionarlos es un refactor
  aparte.

## 12. Riesgos

| Riesgo | Mitigación |
|---|---|
| La regla de validación no está en la base (§4.1) | Aceptado. Enforce en API, test de los cuatro casos |
| Código existente que asume `ENVIADA ⇒ PRESUPUESTADO` | Auditar los consumidores de la transición. `revertirOrdenSinPresupuestoActivo` queda cubierto solo (§5.3); el riesgo vivo son reportes o filtros que cuenten "órdenes presupuestadas" para medir trabajo del técnico |
| El informe no deja rastro en la lista de órdenes (§5.2) | Aceptado y declarado fuera de alcance (§11). Se resuelve con una columna si el taller lo pide |
| Tres caminos de aprobación distintos | Cerrar los tres del lado del servidor, no sólo la UI |
| Invertir el default del selector confunde a quien ya lo aprendió | El enlace "Escribir a mano" queda visible, no escondido |
| El número de migración se lo lleva otra rama | Confirmar el número al mergear, no al crear la rama |

## 13. Plan de entrega

Estimado 450-600 líneas. Dos PRs encadenados:

- **PR 1 — dominio**: migración, `superRefine` compartido, endpoint de entidades,
  ramificación de la transición de orden, variante de PDF, y los tests 1 a 4.
- **PR 2 — interfaz**: bloque de informe en el formulario, vista pública sin
  acciones de aprobación, e inversión del default del selector de ítems.

PR 1 no cambia nada visible: el dominio queda listo y apagado hasta que PR 2
expone los campos. Eso permite mergear y aplicar la migración sin coordinar con
los talleres.
