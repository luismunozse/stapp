# Auditoría contable de STApp

**Fecha:** 19 de septiembre de 2026
**Alcance:** todo lo que toca plata — caja, ventas, órdenes, cobros, gastos, cuentas corrientes, comisiones, compras, facturación y reportes.
**Para quién:** el dueño de STApp y quien programe los arreglos.

---

## Cómo leer esto

Está escrito sin términos técnicos. Cada problema tiene:

- **Qué pasa** — el problema en criollo.
- **Cómo te das cuenta** — la situación concreta en la que te muerde.
- **Cuánto duele** — 🔴 grave / 🟠 importante / 🟡 menor.
- **Dónde está** — la referencia al código, para el que lo tenga que arreglar.

Al final hay un plan por etapas.

---

## Veredicto en 30 segundos

STApp hoy es **muy bueno registrando lo que entra** y **flojo registrando lo que sale**.

Sabés al peso cuánto facturaste, cuánto te costó la mercadería, qué margen dejó cada orden y cuánto te debe cada cliente. Eso está bien resuelto y con bastante cuidado.

Lo que falta para que sea un sistema contable de verdad:

1. **No existe la otra mitad de la contabilidad.** Sabés cuánto te deben. No sabés cuánto debés. No hay cuenta corriente de proveedores, ni pagos a proveedores, ni registro de que la plata salió cuando compraste mercadería.
2. **La plata no tiene dónde estar.** El sistema anota "cobré con MercadoPago" pero nunca lleva el saldo de MercadoPago. No podés responder "¿cuánta plata tengo hoy y dónde está?".
3. **Hay cinco lugares donde los números hoy salen mal y nadie avisa.** Cortes silenciosos a los 1000 registros, meses que arrancan 3 horas antes, comisiones que se restan dos veces. Todo sin un solo mensaje de error.
4. **Nada se cierra nunca.** Un movimiento borrado hoy cambia el balance de marzo, sin dejar rastro de quién lo borró.

Los puntos 3 y 4 son los urgentes: ahí el sistema **te está mintiendo ahora mismo**, y como no hay ningún aviso, vos lo tomás por cierto.

---

## Lo que ya está bien (para no romperlo)

Antes de la lista de problemas, vale decir qué está bien resuelto, porque hay decisiones finas que conviene no tocar:

- **El costo de la mercadería queda congelado al momento de la venta.** Si mañana subís el precio de compra, las ventas de ayer siguen mostrando el margen real de ayer. Eso es exactamente como debe ser.
- **Los ingresos se cuentan cuando el trabajo se hizo, no cuando se cobró**, y las señas cobradas por adelantado se manejan aparte para que no se cuenten dos veces entre un mes y el otro. Es lo correcto y está bien pensado.
- **La devolución en efectivo descuenta de la caja automáticamente**, así el arqueo cierra.
- **El costo de mercadería vendida dejó de ensuciar el arqueo** (era un problema, ya lo arreglaron).
- **Las notas de crédito, las mermas y los costos de las terminales de pago** ya entran en el resultado.
- **Hay tests automáticos sobre caja, comisiones, gastos recurrentes y reportes.** No es poco.

El sistema no está mal hecho. Está **incompleto en el lado de los egresos** y tiene **fallas silenciosas en los reportes**.

---

# Parte 1 — Números que hoy te salen mal

Estos no son "falta una función". Son casos donde la pantalla te muestra un número y el número no es el correcto, sin ningún aviso.

---

### 1.1 🔴 Los reportes cortan a los 1000 registros y no te avisan

**Qué pasa.** Todas las consultas de los reportes de Finanzas piden los datos sin límite. La base de datos, cuando no le pedís paginar, devuelve **como máximo 1000 filas** y se calla la boca. Los reportes suman lo que recibieron y muestran el total como si fuera todo.

**Cómo te das cuenta.** Un taller con 40 ventas por día llega a 1200 ventas en el mes. A partir de ahí, el Estado de Resultados le muestra **los ingresos de 1000 ventas, no de 1200**. La ganancia sale más chica de lo real. Y si el dueño compara con lo que cobró de verdad, no cierra y no hay forma de saber por qué.

Es peor en la solapa **Tendencia**, que mira entre 6 y 24 meses de una: ahí cualquier taller con movimiento pasa los 1000 registros en el primer mes, y los meses viejos aparecen casi vacíos.

Afecta a todas las fuentes por igual: ventas, cobros de órdenes, movimientos de caja, notas de crédito, ajustes de inventario.

**Cómo se arregla.** Dos caminos, y el segundo es el bueno:
- Rápido: paginar las consultas y traer todo de a tandas.
- Correcto: hacer que la suma la haga la base de datos (que devuelva "el total del mes es X" en vez de las 1200 filas para que las sume la aplicación). Es más rápido y no tiene tope.

Mientras tanto, **mínimo**: detectar cuando la consulta volvió con exactamente 1000 filas y mostrar un cartel rojo *"Este reporte está incompleto"*. Es preferible un reporte que avisa que uno que miente.

**Dónde está.** `app/api/reportes/*/route.ts` — ninguna consulta usa `.limit()` ni `.range()`. El tope de 1000 es el valor por defecto de Supabase; conviene confirmar en el panel de Supabase si alguien lo cambió.

---

### 1.2 🔴 Los meses no arrancan cuando vos creés

**Qué pasa.** Cuando elegís "mes actual" en Finanzas, la fecha se calcula en **la compu del usuario**, viaja al servidor como texto ("2026-09-01") y el servidor la vuelve a interpretar **con su propio reloj, que está en horario de Londres**.

Para un taller argentino eso significa que el mes de septiembre, para el reporte, va desde el **31 de agosto a las 21:00** hasta el **30 de septiembre a las 21:00**.

**Cómo te das cuenta.** Todo lo que cobres después de las 21:00 del último día del mes se va al mes siguiente. Un local que cierra a las 20:00 no lo nota. Uno que cierra a las 22:00, o que carga las ventas del día cuando cierra, sí: le faltan las últimas ventas de cada mes y le sobran las de la noche anterior.

Lo mismo pasa en la solapa **Tendencia**: agrupa por mes también con el reloj del servidor.

**Lo peor es que Caja sí lo hace bien.** La pantalla de Caja usa correctamente la zona horaria que configuraste. Finanzas no. Entonces **Caja y Finanzas nunca van a cerrar entre sí**, y el dueño va a pensar que uno de los dos tiene un error de suma.

**Cómo se arregla.** El sistema ya tiene la herramienta hecha y funcionando (`lib/timezone.ts`, usada por Caja). Es aplicar lo mismo en los reportes. Es un arreglo chico con impacto grande.

**Dónde está.**
- `app/api/reportes/estado-resultados/route.ts:43-46` — usa el reloj del servidor.
- `app/api/reportes/resumen-ingresos/route.ts:34-35` — lee la zona horaria de la organización pero **sólo la usa para el nombre del mes**, no para el corte.
- `app/api/reportes/tendencia-financiera/route.ts:89` — agrupa por mes con el reloj del servidor.
- `lib/finanzas-period.ts:21-27` — las fechas se calculan en el navegador.
- Comparar con `app/api/caja/movimientos/route.ts:28-36` y `app/api/clientes/[id]/cuenta-corriente/resumen/route.ts:56`, que lo hacen bien.

---

### 1.3 🔴 Las comisiones se te restan dos veces

**Qué pasa.** El Estado de Resultados ya descuenta la comisión del técnico y del vendedor **cuando el trabajo se hizo**, aunque todavía no se la hayas pagado. Está bien: es la forma correcta de medir si el mes fue rentable.

El problema es el botón **"Marcar comisión como pagada"**. Lo único que hace es prender una tilde. **No registra que la plata salió de la caja.**

**Cómo te das cuenta.** Le pagás $80.000 de comisiones a los técnicos. La plata sale del cajón. A la noche hacés el arqueo y te faltan $80.000. Para que cierre, cargás un gasto de $80.000.

Resultado: el Estado de Resultados te restó las comisiones **una vez** cuando se hicieron los trabajos, y **otra vez** cuando cargaste el gasto. Tu ganancia del mes aparece $80.000 más baja de lo que es.

Y si en vez de eso no cargás el gasto, el arqueo te da faltante todos los meses de pago.

O sea: **de las dos maneras te queda mal**. No hay forma correcta de operar hoy.

**Cómo se arregla.** Que "pagar comisión" genere el egreso de caja automáticamente, marcado de forma que el Estado de Resultados sepa que **no** lo tiene que restar de nuevo (ya existe el mecanismo: la marca "no afecta rentabilidad", la misma que usan los retiros de socio).

**Dónde está.** `app/api/comisiones/pagar/route.ts:20` y `app/api/comisiones/vendedores/pagar/route.ts:23` — sólo escriben `comision_pagada: true`.

---

### 1.4 🟠 Comprar mercadería no mueve plata

**Qué pasa.** Cuando cargás una orden de compra y recibís la mercadería, el stock sube y el costo queda registrado. **Pero la plata que le pagaste al proveedor no sale de ningún lado.**

**Cómo te das cuenta.** Pagás $500.000 en repuestos. El arqueo del día te da $500.000 de faltante. Cargás el gasto a mano para que cierre.

Ahora tenés el mismo problema que con las comisiones: ese medio millón se va a descontar **otra vez**, de a poco, como "costo de mercadería vendida" a medida que vendas los repuestos. Te lo comiste dos veces.

**Cómo se arregla.** Al recibir una compra, registrar la salida de plata **como pago a proveedor**, no como gasto operativo. Es una categoría distinta: la plata sale pero no es un gasto del mes — se convirtió en stock. Está atado al punto 2.1 (cuentas por pagar).

**Dónde está.** `app/api/ordenes-compra/[id]/recibir/route.ts` — no toca caja ni registra ningún pago. La tabla `ordenes_compra` (`supabase/migrations/109_ordenes_compra_y_barcode.sql`) no tiene columnas de pagado / pendiente.

---

### 1.5 🟠 Las diferencias de caja no van a ningún lado

**Qué pasa.** Cuando cerrás la caja, el sistema calcula la diferencia entre lo que debería haber y lo que contaste, y la guarda. **Y ahí queda.** El Estado de Resultados nunca la mira.

**Cómo te das cuenta.** Si todos los días te faltan $2.000 en el cajón, son $60.000 por mes que desaparecen y **no aparecen en ningún reporte de ganancia**. El sistema los vio, los anotó, y no se lo dijo a nadie.

**Cómo se arregla.** Dos cosas:
1. Que la diferencia del cierre entre en el resultado del mes como "faltantes y sobrantes de caja".
2. Un reporte de diferencias por período y por persona que cierra. Un faltante puntual es un error de vuelto; un faltante todos los martes es otra cosa.

**Dónde está.** `app/api/caja/sesiones/[id]/cerrar/route.ts:73` calcula y guarda `diferencia`. Nadie la lee después.

---

### 1.6 🟠 Un movimiento de caja se borra y no queda rastro

**Qué pasa.** Borrar un movimiento de caja lo **elimina de verdad** de la base de datos. No queda registrado quién lo borró, ni cuándo, ni qué decía.

El único freno es que la caja esté cerrada. Pero el sistema **permite cargar movimientos sin caja abierta** — y esos **se pueden borrar siempre**, sin límite de tiempo.

**Cómo te das cuenta.** Mirás la ganancia de marzo. Tres meses después la volvés a mirar y da distinto. No hay forma de saber por qué, ni quién lo cambió.

Para una organización de una sola persona es molesto. Con empleados que manejan caja, es un agujero.

**Cómo se arregla.** Nunca borrar movimientos de plata: marcarlos como anulados, guardando quién y cuándo. Y sumar caja, cobros y pagos a la lista de cosas que se auditan — el sistema de auditoría **ya existe y funciona**, simplemente no cubre el dinero (cubre órdenes, clientes, inventario, ventas, pero no caja ni pagos).

**Dónde está.** `app/api/caja/movimientos/[id]/route.ts:52` — borrado físico. La lista de entidades auditadas está en `lib/audit.ts:7-23` (`AuditEntity`) y no incluye `movimientos_caja`, `sesiones_caja`, `cobros_orden`, `pagos_venta` ni `pagos_parciales`.

**Bonus del mismo problema:** el dueño **no tiene ninguna pantalla** para ver el historial de cambios. La auditoría se guarda, pero sólo la puede consultar el administrador de la plataforma, no el dueño del taller.

---

### 1.7 🟠 El detector de cuentas corrientes descuadradas existe, pero nadie lo mira

**Qué pasa.** Hay varios lugares donde, si falla el registro en la cuenta corriente del cliente, **el sistema sigue adelante como si nada** y sólo anota el error en un log técnico que nadie lee. La entrega se completa, el cobro se registra, pero la deuda del cliente queda mal.

Alguien se dio cuenta de esto y construyó un detector: una consulta que compara el saldo de cada cliente contra la suma de sus movimientos y lista todo lo que no cierra. Está bien hecha, cubre cuatro tipos de descuadre.

**Nadie la consulta.** No hay tarea automática, no hay pantalla, no hay alerta. Se escribió y quedó guardada.

**Cómo te das cuenta.** No te das cuenta. Ese es el punto. Un cliente te debe $40.000 y el sistema dice $15.000, o al revés, y te enterás cuando el cliente reclama.

**Cómo se arregla.** Dos pasos, los dos chicos:
1. Una tarea diaria que corra el detector y avise si encontró algo.
2. Que los errores de cuenta corriente **dejen de ser silenciosos**: si no se puede registrar la deuda, la operación no se completa, o por lo menos se avisa en pantalla.

**Dónde está.** `supabase/migrations/245_v_cc_drift.sql` — la vista `v_cc_drift`. No aparece mencionada en ningún otro lado del código. Los puntos que fallan en silencio: `app/api/ordenes/[id]/entregar/route.ts:201`, `app/api/ordenes/[id]/cobros/route.ts:342`, `app/api/ventas/[id]/pagos/route.ts:338`, `app/api/facturacion/[id]/route.ts:347`.

---

### 1.8 🟡 Los repuestos cargados a mano inflan la ganancia

**Qué pasa.** Cuando en una cotización cargás un repuesto que no está en el inventario y le ponés sólo el precio de venta, el sistema no sabe qué te costó. Y en vez de avisar, **asume que costó cero**.

**Cómo te das cuenta.** Ese trabajo aparece con 100% de margen. Si muchos repuestos se cargan a mano, la ganancia del mes está inflada y no hay forma de verlo.

**Cómo se arregla.** Un campo opcional de costo al cargar el repuesto a mano, y un cartel en Finanzas: *"Hay N repuestos sin costo cargado — la ganancia puede estar más alta de lo real"*.

**Dónde está.** `app/api/reportes/estado-resultados/route.ts` — el bloque de costos de cotizaciones descarta los items con costo 0 (`if (costo <= 0) continue`).

---

# Parte 2 — Lo que falta entero

Acá no hay error: simplemente no existe la funcionalidad.

---

### 2.1 🔴 No existe "lo que le debés a tus proveedores"

**Qué falta.** Todo el lado de las deudas propias:

- No hay cuenta corriente de proveedores. No podés ver "a Distribuidora X le debo $300.000".
- Las órdenes de compra no tienen estado de pago: no hay "pagada", "debo la mitad", "vence el 15".
- No se pueden registrar pagos a proveedores.
- No hay reporte de vencimientos: "esta semana tengo que pagar $X".

**Por qué importa.** Un sistema contable sirve para dos preguntas: **cuánto me deben** y **cuánto debo**. STApp responde muy bien la primera y **no responde la segunda en absoluto**.

Sin esto no hay balance, no hay flujo de caja proyectado y no sabés si la plata que ves en el cajón ya tiene dueño.

**Qué habría que hacer.** Espejar lo que ya existe para clientes: una cuenta corriente por proveedor con cargos (compras) y pagos, el saldo a la vista en la ficha del proveedor, y un listado de vencimientos.

La buena noticia es que el modelo de cuenta corriente de clientes ya está hecho y anda bien. Es replicarlo, no inventarlo.

**Dónde está.** La tabla `proveedores` (`supabase/migrations/001_schema.sql`) tiene nombre, teléfono y dirección — nada de plata.

---

### 2.2 🔴 La plata no tiene dónde estar

**Qué falta.** El sistema anota **cómo** cobraste cada cosa (efectivo, transferencia, MercadoPago, tarjeta) pero nunca lleva el **saldo** de cada uno.

No podés responder:
- ¿Cuánta plata tengo hoy en MercadoPago?
- ¿Cuánto hay en el banco?
- ¿Cuánto en el cajón?
- ¿Cuánto me falta cobrar de las tarjetas?

El arqueo de caja **sólo cuenta efectivo**. Todo lo demás pasa por el sistema y se evapora.

**Por qué importa.** Es la pregunta más básica de todas: *"¿cuánta plata tengo y dónde está?"*. Y también es la única forma de detectar que un cobro por transferencia se registró pero nunca llegó al banco.

**Qué habría que hacer.** Agregar el concepto de **cuentas de dinero** (Caja chica, Banco, MercadoPago, cada tarjeta). Cada cobro y cada pago entra o sale de una cuenta. Después:

- Una pantalla de saldos: cuánto hay en cada una, hoy.
- Transferencias entre cuentas (saqué del cajón y lo deposité).
- Conciliación: marcar qué movimientos ya aparecieron en el resumen del banco y cuáles no.
- Fecha de acreditación para las tarjetas: cobrado hoy, disponible en 18 días.

Es el cambio más grande de esta lista, pero es **el que convierte STApp en un sistema contable** en vez de un sistema de gestión con reportes.

---

### 2.3 🟠 No podés cobrarle la deuda a un cliente

**Qué falta.** Un cliente te debe $50.000 repartidos en cinco ventas y tres órdenes. Viene y te da $30.000 a cuenta.

Hoy **no hay forma de registrar eso**. En la ficha del cliente el único botón es "Registrar Depósito a Cuenta", que sirve para adelantos, no para cancelar deuda. Para imputar el pago tenés que entrar venta por venta y orden por orden, y decidir vos a mano cuánto va a cada una.

**Qué más falta en cuenta corriente:**

- **Límite de crédito por cliente.** Hoy le podés fiar sin tope y el sistema no dice nada.
- **Vencimiento de la deuda.** No hay "a 30 días". La deuda no vence nunca.
- **Antigüedad de la deuda.** No podés ver "de los $800.000 que me deben, $200.000 tienen más de 90 días". Es el dato con el que se decide a quién llamar.
- *(El resumen de cuenta en PDF por período **sí** existe y está bien hecho — respeta la zona horaria del taller. Lo que falta es lo de arriba.)*

**Dónde está.** `components/clientes/detalle/cuenta-corriente-panel.tsx:171-178` — el único botón. El endpoint de pago de deuda (`pagar_fiado_cuenta_corriente`) existe en la base, pero sólo se puede llamar desde una venta o una orden específica.

---

### 2.4 🟠 Los gastos están escondidos adentro de Caja y sólo se pueden cargar hoy

Cuatro problemas del mismo lugar:

**a) No podés ponerle fecha a un gasto.** Todo gasto se registra con la fecha y hora en que lo cargaste. Si el lunes pagaste el alquiler y lo cargás el miércoles, queda como gasto del miércoles. Para un taller que cierra el mes el día 5, eso es un problema todos los meses.

**b) No hay un listado de gastos.** La solapa Gastos de Finanzas muestra totales por categoría, nada más. Para ver los gastos uno por uno tenés que ir a Caja → Movimientos, y **Caja sólo te muestra el día**. No hay "todos los gastos de septiembre".

**c) No se pueden exportar.** Se exporta el día de caja. No hay forma de bajar los gastos de un mes para mandárselos al contador.

**d) Los gastos fijos no se generan solos.** Podés cargar el alquiler como gasto mensual, pero **el sistema no lo genera automáticamente**. Hay que entrar a Configuración → Gastos Recurrentes y apretar un botón. Si no entrás, el alquiler no existe en la ganancia del mes.

Y cuando lo apretás, el gasto se registra **con la fecha de hoy**, no con la fecha en que vencía. Si generás en mayo los gastos de marzo, marzo sigue sin el alquiler y mayo tiene dos.

**Cómo se arregla.** Campo de fecha al cargar el gasto (con un tope razonable hacia atrás); una pantalla de gastos por período con filtros y exportación; y una tarea automática diaria que genere los gastos fijos, fechados el día que corresponde.

**Dónde está.** `app/api/caja/movimientos/route.ts:120-141` (el alta no acepta fecha), `app/api/caja/export/route.ts:39` (exporta sólo el día), `app/api/gastos-recurrentes/materializar/route.ts:82-100` (fecha de hoy), `vercel.json` (hay 11 tareas automáticas configuradas; ninguna es la de gastos recurrentes).

---

### 2.5 🟠 La facturación cubre sólo una parte del negocio

**Qué falta.**

- **No se puede facturar una reparación.** La factura electrónica está atada a las ventas del mostrador. Una orden de servicio — que es el corazón del negocio — **no se puede facturar**.
- **No hay Factura A.** Sólo B y C. Si tu cliente es una empresa que necesita A, no la podés emitir.
- **No hay nota de crédito fiscal.** Las notas de crédito del sistema son internas: corrigen tus números pero no van a la AFIP. Si facturaste mal, no hay forma de anularlo formalmente.
- **El IVA sólo existe en las ventas del mostrador.** Las órdenes de servicio no discriminan IVA en ningún lado.
- **No hay IVA de compras.** No se registra el IVA que pagás cuando comprás.
- **No hay libro de IVA.** Como consecuencia de lo anterior: no podés sacar "este mes cobré $X de IVA y pagué $Y, tengo que depositar la diferencia". Hay que hacerlo a mano.
- **Un solo porcentaje de IVA para todo.** Si vendés cosas al 21% y otras al 10,5%, no entra.

**Dónde está.** `supabase/migrations/296_facturacion_electronica.sql:49` (la factura exige una venta), `lib/facturacion/derive.ts:3` ("Factura A out of scope"), `supabase/migrations/229_org_fiscal_iva_redondeo.sql` (el IVA se guarda sólo en `ventas`).

---

### 2.6 🟠 Nada se cierra nunca

**Qué falta.** No existe el cierre de mes. Todo es editable para siempre: se puede borrar un movimiento de enero, cambiar el precio de una orden vieja, anular una venta del año pasado. Y el balance de ese mes cambia.

**Por qué importa.** Si presentaste los números de marzo y hoy dan distinto, ninguno de los dos números sirve. Un sistema contable necesita poder decir *"marzo está cerrado, estos son los números finales"*.

**Qué habría que hacer.** Un botón "Cerrar mes" que:
- Congele el total del período (guardado, no recalculado cada vez que se mira).
- Impida cargar, editar o borrar movimientos con fecha anterior al cierre.
- Permita reabrirlo sólo al dueño, dejando registrado quién y cuándo.

Como beneficio extra, los reportes de meses cerrados salen instantáneos porque no hay que recalcular nada — y de paso esquivan el problema 1.1.

---

### 2.7 🟠 No hay un rol para el contador

**Qué falta.** Hay tres roles: Administrador, Técnico y Vendedor. Para que el contador vea los números hay que darle **Administrador**, y con eso puede borrar movimientos, cambiar precios, dar de alta usuarios y modificar la configuración fiscal.

**Qué habría que hacer.** Un rol de **sólo lectura de finanzas**: ve todos los reportes, exporta todo, no toca nada. Es el rol que va a pedir el 100% de los clientes que tengan contador.

Y sumarle la pantalla de historial de cambios que hoy no existe (ver 1.6).

---

# Parte 3 — Riesgos a futuro

🟡 Cosas que hoy no molestan pero van a molestar.

- **Una sola moneda.** Todo se guarda en la moneda del taller. Si comprás repuestos en dólares, no hay forma de registrarlo ni de saber cuánto perdiste o ganaste por el tipo de cambio. Hay una consulta de la cotización del dólar en el sistema, pero es sólo un cartelito informativo: no se usa para nada.

- **Tope de $99.999.999,99 por operación.** Los montos están guardados con ocho dígitos. Una compra grande a proveedor o la venta de un equipo caro puede pasarlo, y cuando pase la operación va a fallar con un error que nadie va a entender. Con inflación esto se acerca solo.

- **Un solo precio de costo por producto.** Si comprás 10 unidades a $80 y después 10 a $120, el sistema se queda con un solo número. Las ventas ya hechas están protegidas (guardan el costo del momento), pero las nuevas van a usar un costo que puede no ser el real. Lo correcto es promedio ponderado.

- **Filtro de costo de mercadería por texto.** Para limpiar unos registros históricos del arqueo, el sistema descarta los movimientos cuyo texto empieza con "Costo de mercader...". Si alguien carga un gasto real con ese nombre, desaparece del arqueo sin avisar. Es una frágil heredada de un arreglo ya hecho; conviene reemplazarla por una marca explícita.

---

# Plan sugerido

Ordenado por **dolor que saca dividido por trabajo que cuesta**.

### Etapa 1 — Que los números dejen de mentir (2 a 3 semanas)

Nada nuevo. Arreglar lo que ya está y hoy da mal.

1. Zona horaria en los tres reportes (1.2) — chico, la herramienta ya existe.
2. Sacar el corte de 1000 registros, o como mínimo avisar cuando pasa (1.1).
3. Que pagar comisiones genere el egreso de caja (1.3).
4. Que la diferencia de caja entre en el resultado (1.5).
5. Prender el detector de cuentas corrientes descuadradas con aviso diario (1.7).
6. Dejar de borrar movimientos de plata; auditar caja, cobros y pagos (1.6).

**Después de esta etapa los números cierran.** Es la base de todo lo demás: no tiene sentido construir arriba de reportes que mienten.

### Etapa 2 — Que se pueda cargar lo que sale (3 a 4 semanas)

7. Fecha en los gastos + pantalla de gastos por período + exportación (2.4 a,b,c).
8. Tarea automática de gastos fijos, con la fecha correcta (2.4 d).
9. Cuenta corriente de proveedores: saldo, pagos, vencimientos (2.1).
10. Que recibir una compra registre la salida de plata como pago a proveedor (1.4).

**Después de esta etapa ya sabés cuánto debés.**

### Etapa 3 — Que se sepa dónde está la plata (4 a 6 semanas)

11. Cuentas de dinero: caja, banco, MercadoPago, tarjetas (2.2).
12. Pantalla de saldos y transferencias entre cuentas.
13. Conciliación bancaria básica.
14. Cierre de mes con bloqueo (2.6).
15. Rol de sólo lectura para el contador + pantalla de historial de cambios (2.7).

**Después de esta etapa STApp es un sistema contable.**

### Etapa 4 — Lo impositivo (a demanda del cliente)

16. Cobrar deuda a cuenta, límite de crédito, antigüedad de deuda (2.3).
17. IVA en órdenes de servicio y en compras.
18. Libro de IVA ventas y compras.
19. Factura A y notas de crédito fiscales (2.5).
20. Facturar órdenes de servicio, no sólo ventas (2.5).

Esta etapa conviene priorizarla con clientes reales: qué necesitan primero depende de su condición fiscal.

---

## Nota sobre el plan anterior

Existe `docs/PLAN_FINANZAS_PENDIENTE.md`, de mayo, con varios de estos temas. Vale actualizarlo: **varios puntos ya están hechos** (notas de crédito, mermas de inventario, IVA en ventas, costo de repuestos en cotizaciones, costo financiero en cobros directos, tests financieros) y siguen figurando como pendientes.

Lo que ese plan **no tenía** y esta auditoría agrega: cuentas por pagar (2.1), cuentas de dinero (2.2), el corte de 1000 registros (1.1), la zona horaria (1.2), la doble resta de comisiones (1.3), el detector de descuadres sin usar (1.7), el rol de contador (2.7) y el borrado sin rastro (1.6).
