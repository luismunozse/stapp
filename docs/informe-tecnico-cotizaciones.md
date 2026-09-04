# Informe técnico para seguros (cotizaciones)

Fecha: 2026-09-04
Estado: diseño aprobado, pendiente de plan de implementación

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
  ADD COLUMN veredicto        TEXT,
  ADD COLUMN diagnostico      TEXT,
  ADD COLUMN causa_dano       TEXT,
  ADD COLUMN presentado_ante  TEXT;

ALTER TABLE cotizaciones ADD CONSTRAINT cotizaciones_veredicto_check
  CHECK (veredicto IS NULL OR veredicto IN ('REPARABLE','IRREPARABLE','SIN_FALLA'));

ALTER TABLE cotizaciones ADD CONSTRAINT cotizaciones_causa_dano_check
  CHECK (causa_dano IS NULL OR causa_dano IN
    ('CAIDA','LIQUIDO','SOBRETENSION','DESGASTE','USO_INDEBIDO','FALLA_FABRICA','DESCONOCIDA'));
```

Numeración: al momento de escribir este diseño la migración más alta en
`supabase/migrations/` es la `321_email_delivery_tracking.sql`, con lo que el
número libre es el **322**. El número definitivo se confirma al mergear, no al
crear la rama: otra rama en vuelo puede tomarlo antes.

### 3.1 Por qué no se toca `tipo`

`cotizaciones.tipo` ya existe (migración 126) con `CHECK ('ORDEN','PRESUPUESTO')`.
Responde una pregunta distinta: si el documento cuelga de una orden de trabajo o
vuela solo con snapshot de equipo y checklist. Es ortogonal al veredicto —
un informe irreparable puede ser `ORDEN` (el equipo está en el taller) o
`PRESUPUESTO` (peritaje suelto). Agregar `'INFORME'` como tercer valor mezclaría
dos ejes y obligaría a productos cruzados imposibles de expresar.

El informe no es un tipo: es la consecuencia de un veredicto que no admite ítems.

### 3.2 Por qué `diagnostico` se duplica

`ordenes_servicio.diagnostico TEXT` ya existe (`supabase/migrations/001_schema.sql:199`).
La cotización guarda igual su propia copia, por dos razones:

1. El diagnóstico de la orden sigue mutando después de emitido el documento. Un
   informe presentado ante una aseguradora no puede cambiar a espaldas de nadie.
2. Una cotización puede ser standalone (`orden_id IS NULL` desde la migración
   052), y entonces no hay orden de la cual leer.

El formulario **precarga** el campo desde la orden cuando existe, para no obligar
a tipear dos veces. Lo que se persiste es la copia congelada.

### 3.3 Autocompletado de `presentado_ante`

Endpoint nuevo `GET /api/cotizaciones/entidades`:

```sql
SELECT DISTINCT presentado_ante
FROM cotizaciones
WHERE organization_id = $1
  AND presentado_ante IS NOT NULL
  AND deleted_at IS NULL
ORDER BY 1
LIMIT 50
```

Alimenta un `<datalist>` en el formulario. Sin tabla, sin ABM, sin migración
adicional. Evita que la misma aseguradora quede escrita de cinco formas
distintas sin obligar a nadie a dar de alta nada.

Guard: `requireAuth()` + scope por `organization_id`. Devuelve sólo strings.

## 4. Reglas de validación

El `.min(1)` de `app/api/cotizaciones/route.ts:61` se reemplaza por un
`superRefine` compartido entre POST y PUT.

| Ítems | Veredicto | Resultado |
|---|---|---|
| ≥ 1 | cualquiera, o ausente | Válido (comportamiento actual, sin cambios) |
| 0 | `IRREPARABLE` o `SIN_FALLA` | Válido, pero `diagnostico` y `causa_dano` pasan a obligatorios |
| 0 | ausente | Rechazado: `"Una cotización sin ítems necesita un veredicto técnico"` |
| 0 | `REPARABLE` | Rechazado: `"Si el equipo es reparable, el presupuesto necesita al menos un ítem"` |

`diagnostico` obligatorio significa no vacío después de `trim()`.

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

Hallazgo que evita rediseñar nada: `estado_orden` **ya modela** los dos
desenlaces sin reparación.

- `SIN_REPARACION` — definido en `supabase/migrations/005_update_estados_orden.sql:20`,
  documentado como "No se puede reparar o cliente rechazó".
- `SIN_FALLA_DETECTADA` — agregado por `supabase/migrations/262_estado_sin_falla_detectada.sql`.

El veredicto mapea uno a uno:

| Veredicto | Orden pasa a |
|---|---|
| `REPARABLE` (o ausente) | `PRESUPUESTADO` — comportamiento actual |
| `IRREPARABLE` | `SIN_REPARACION` |
| `SIN_FALLA` | `SIN_FALLA_DETECTADA` |

### 5.3 Bug a evitar antes de escribirlo

Hoy hay **dos** puntos que empujan la orden a `PRESUPUESTADO` de forma
incondicional al pasar la cotización a `ENVIADA`:

- `app/api/cotizaciones/[id]/enviar/route.ts:172-199`
- `app/api/cotizaciones/[id]/route.ts:800-833` (la ruta PUT, que usa el botón
  "Enviar y compartir" de la lista, salteando el envío de mail)

Sin tocar los dos, emitir un informe irreparable dejaría la orden en
`PRESUPUESTADO`, esperando la respuesta a un presupuesto que no existe. Ambos
deben ramificar por veredicto.

Corolario: cualquier código que hoy asuma "cotización `ENVIADA` ⇒ orden
`PRESUPUESTADO`" queda inválido. Verificar en particular
`revertirOrdenSinPresupuestoActivo` (`app/api/cotizaciones/[id]/route.ts:94-137`),
que sólo revierte desde `PRESUPUESTADO`: al borrar o rechazar un informe, la
orden puede estar en `SIN_REPARACION` y no debe revertirse silenciosamente.

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

- Línea "Para ser presentado ante: {entidad}" bajo los datos del cliente, siempre
  que el campo tenga valor
- Bloque Veredicto / Diagnóstico / Causa probable del daño, siempre que haya
  veredicto

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
2. Transición de orden por veredicto: `IRREPARABLE` deja la orden en
   `SIN_REPARACION`, no en `PRESUPUESTADO`. Cubrir los **dos** caminos de envío
   (`/enviar` y el PUT).
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
- Unificar el selector de ítems de órdenes con el de cotizaciones. Son contratos
  de API distintos (órdenes reserva stock y persiste por ítem; cotizaciones no
  reserva y persiste al guardar el documento entero). Fusionarlos es un refactor
  aparte.

## 12. Riesgos

| Riesgo | Mitigación |
|---|---|
| La regla de validación no está en la base (§4.1) | Aceptado. Enforce en API, test de los cuatro casos |
| Código existente que asume `ENVIADA ⇒ PRESUPUESTADO` | Auditar los consumidores de la transición, en particular `revertirOrdenSinPresupuestoActivo` |
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
