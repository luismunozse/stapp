# Eliminación de cuenta: usuario y taller

**Fecha:** 2026-10-05
**Branch:** `feat/account-deletion`

## Problema

Google Play exige que toda app que permite crear cuentas ofrezca eliminarlas
desde dentro de la app y también desde una URL web pública. La app Android de
STApp es un shell de Capacitor que carga el panel web, y la pantalla de entrada
(`app/app-entry/page.tsx`) ofrece "Registrar mi negocio". Hoy no existe ningún
camino de eliminación:

- La política de privacidad (`app/legal/privacidad/page.tsx`, §6 y §7) dice que
  la eliminación se pide "desde la configuración de su cuenta". Esa opción no
  existe.
- Los únicos borrados son administrativos: un ADMIN borra un técnico o un
  vendedor (`app/api/tecnicos/[id]`, `app/api/vendedores/[id]`), y el
  superadmin archiva o purga una organización
  (`app/api/superadmin/organizations/[id]`).

Además, la purga del superadmin tiene dos defectos que este trabajo hereda y
corrige:

1. No cancela la suscripción en el proveedor. Un taller pago purgado sigue
   cobrándose.
2. Limpia solo seis buckets de storage y solo el primer nivel de `{orgId}/`.
   Las fotos de órdenes (`{orgId}/{ordenId}/archivo`), el catálogo, los
   adjuntos de proveedores, los de soporte y los CSV importados quedan
   huérfanos.

## Restricciones del modelo de datos

- **Un usuario pertenece a una sola organización** (`users.email` único,
  `users.organization_id` NOT NULL). No hay concepto de "dueño": el registro
  crea un ADMIN y puede haber varios.
- **La fila de un usuario con historia no se puede borrar.** Varias FK hacia
  `users` no tienen `ON DELETE` y algunas son NOT NULL: `ventas.vendedor_id`,
  `sesiones_caja.usuario_apertura_id`, `importaciones.user_id`,
  `admin_emails.sent_by`, `ordenes_servicio.tecnico_id`, `cobros_orden`,
  `cuenta_corriente`, `notas_credito`, entre otras. Por eso el usuario se
  **anonimiza**, no se borra.
- **Borrar una organización arrastra sus comprobantes fiscales.**
  `comprobantes_fiscales.organization_id` es `ON DELETE CASCADE`
  (`supabase/migrations/296_*.sql:48`), y lo mismo ocurre con `facturas`,
  `ventas`, `notas_credito` y `cuenta_corriente`. El emisor fiscal es el taller
  (su propio CUIT), no STApp. La obligación de conservar la documentación es
  del taller.
- **El archivado ya bloquea el acceso.** Con `organizations.deleted_at` seteado
  falla el login (`lib/auth.ts`) y el middleware corta la API y el panel
  (`lib/tenant-status-edge.ts`, caché de 30 s).

## Decisiones de producto

1. **Dos niveles.**
   - Cualquier usuario puede eliminar su propio usuario. El taller sigue
     funcionando y sus operaciones quedan firmadas como "Usuario eliminado".
   - Un ADMIN puede eliminar el taller completo: organización, datos y
     suscripción.
   - El último ADMIN de un taller no puede eliminar solo su usuario: debe
     eliminar el taller o pasarle el rol a otro usuario.
2. **30 días de gracia.** La desactivación es inmediata y la suscripción se
   cancela en el momento. Durante 30 días soporte puede revertir el pedido.
   Pasado ese plazo, un cron borra de forma definitiva.
3. **URL web pública = página informativa + login.** No hay formulario de
   borrado sin sesión. La página lleva al login del taller y de ahí al mismo
   flujo que se usa en la app.
4. **Respaldo y después borrado total.** Antes de confirmar el borrado del
   taller, el ADMIN puede descargar un ZIP con su información fiscal y
   comercial. Pasados los 30 días no se retiene nada.

## Diseño

### Modelo de datos

Una migración (número asignado al mergear):

```sql
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS organizations_deletion_requested_at_idx
  ON organizations (deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_deleted_at_idx
  ON users (deleted_at)
  WHERE deleted_at IS NOT NULL;
```

Más una función SQL para la guarda del último ADMIN (ver "Concurrencia").

- `organizations.deletion_requested_at` distingue "el taller pidió que lo
  borren" de "se archivó por inactividad" (`auto-archive-dormant`), que también
  setea `deleted_at`. No se usa `archived_reason` como criterio porque es texto
  libre. Igual se escribe `archived_reason = 'user_requested_deletion'` para que
  el panel de superadmin lo muestre.
- `users.deleted_at` marca a un usuario dado de baja. Se setea al pedir el
  borrado; la anonimización ocurre a los 30 días.

La restauración la hace el superadmin con
`app/api/superadmin/organizations/[id]/restore`, que pasa a limpiar también
`deletion_requested_at`. La suscripción cancelada no se reactiva: el taller
vuelve a suscribirse. Para restaurar un usuario, soporte limpia
`users.deleted_at` a mano mientras la fila no esté anonimizada.

### Flujo A: eliminar mi usuario

- **Ubicación.** `app/(dashboard)/perfil/page.tsx`, sección "Zona de peligro"
  al final. Es la única pantalla accesible para los tres roles.
- **Modal.** Explica qué se borra (datos personales) y qué se conserva (las
  operaciones registradas, firmadas como "Usuario eliminado"). Si el usuario es
  el último ADMIN, la opción aparece deshabilitada con la explicación y un
  acceso al flujo B.
- **Reautenticación.** Contraseña para usuarios `credentials`. Los usuarios
  `google` tipean su email. En ambos casos se pide además el código TOTP si
  tienen 2FA activo.
- **`POST /api/account/delete-user`.**
  1. Valida la sesión y la reautenticación.
  2. Llama a la función SQL de la guarda, que en la misma transacción verifica
     que no sea el último ADMIN y setea `users.deleted_at = now()`. Si es el
     último ADMIN, responde 409 sin cambios.
  3. Invalida `refresh_token`.
  4. Borra `push_tokens` y `web_push_subscriptions` del usuario.
  5. Envía un email a los ADMIN del taller avisando de la baja.
  6. Responde 200; el cliente cierra la sesión.

### Flujo B: eliminar el taller

Solo ADMIN, desde la misma sección de `/perfil`.

1. **Respaldo.** Botón "Descargar respaldo" → `GET /api/account/export`
   (`requireAdmin`). Devuelve un ZIP generado en streaming con:
   - CSV de `comprobantes_fiscales`, `ventas` con sus ítems y pagos, `facturas`,
     `notas_credito`, `cuenta_corriente` y `clientes`.
   - Los PDFs de comprobantes que ya estén guardados en storage, hasta 300
     archivos o 100 MB, lo que ocurra primero. Si se supera, el ZIP incluye
     `LEEME.txt` con el aviso y un `pdfs-pendientes.csv` con los links. Los
     topes son constantes del módulo y se ajustan si las pruebas reales
     muestran que entran más dentro de los 60 s.

   Para avanzar hay que tildar "Descargué mi respaldo o no lo necesito". El
   texto aclara que conservar la documentación fiscal es obligación del taller.
2. **Confirmación.** Tipear el subdominio del taller más la reautenticación del
   flujo A.
3. **`POST /api/account/delete-organization`** (`requireAdmin`).
   1. Valida la reautenticación y el subdominio.
   2. Cancela la suscripción en cada proveedor con id (`lib/mercadopago.ts`
      `cancelPreApproval`, `lib/rebill.ts`, `lib/creem.ts`). **Si alguna
      cancelación falla, responde 502 y no cambia nada.**
   3. Setea en `organizations`: `deleted_at`, `deleted_by` (email del ADMIN),
      `archived_reason = 'user_requested_deletion'`, `deletion_requested_at`.
      En `subscriptions` setea `canceled_at`.
   4. Envía un email a todos los ADMIN con la fecha de borrado definitivo y cómo
      revertir con soporte.
   5. Responde 200; el cliente cierra la sesión y vuelve a `/app-entry` en
      nativo, o a la landing en web.

### Página pública `/legal/eliminar-cuenta`

Es la URL que se declara en Play Console. `app/legal/eliminar-cuenta/page.tsx`
usa el layout legal existente.

- Explica qué se borra, qué se conserva y los plazos.
- Tiene un campo de subdominio que lleva a
  `https://{slug}.stapp.com.ar/login?callbackUrl=/perfil%23eliminar`, con la
  misma validación de slug que `app-entry`.
- Ofrece `CONTACT_EMAIL` (`lib/contact.ts`) para quien no pueda entrar.
- Se agrega `/legal` a `isPublicPath` en `middleware.ts`, para que también
  funcione desde un subdominio sin sesión.
- La política de privacidad §6 y §7 pasa a enlazar esta página.

### Cron `account-deletion-purge`

`app/api/cron/account-deletion-purge/route.ts`, diario, protegido con
`requireCronAuth`. Se registra en `vercel.json` y en `lib/cron-config.ts`. Sigue
el patrón de `auto-archive-dormant`: es dry-run salvo que
`ACCOUNT_DELETION_PURGE_ENABLED=true`.

- **Talleres.** Selecciona organizaciones con
  `deletion_requested_at < now() - interval '30 days'` y `deleted_at` no nulo.
  Ignora las archivadas por inactividad. Ejecuta `purgeOrganization(orgId)`.
- **Usuarios.** Selecciona `users.deleted_at < now() - interval '30 days'` que
  todavía no estén anonimizados y ejecuta `anonymizeUser(userId)`.
- Procesa por lotes acotados para respetar los 60 s de `maxDuration` y loguea
  cada resultado.

### `purgeOrganization(orgId)`

En `lib/account-deletion/purge-organization.ts`. La usan el cron y la purga
`?hard=true` del superadmin, que deja de tener su propia implementación.

1. Cancela la suscripción en cada proveedor. "Ya cancelada" cuenta como éxito.
2. Borra de forma recursiva `{orgId}/` en todos los buckets: los de
   `STORAGE_BUCKETS` más `proveedor-adjuntos`.
3. Borra la fila de `organizations`; el resto cae en cascada.

Cada paso es idempotente. Si uno falla, la función corta, devuelve el paso
fallido y el cron reintenta al día siguiente.

### `anonymizeUser(userId)`

En `lib/account-deletion/anonymize-user.ts`.

- `email = 'deleted+{id}@deleted.stapp.invalid'`, `nombre = 'Usuario eliminado'`.
- A null: `password`, `telefono`, `avatar_url`, `refresh_token`, tokens de reset
  y de verificación, campos TOTP. También se borran el archivo del avatar en
  storage y las filas de `totp_used_codes`.
- Borra `push_tokens` y `web_push_subscriptions` si quedara alguna.
- Pone en null `ip_address` y `user_agent` en los `audit_logs` del usuario. El
  registro de acciones se conserva.
- Es idempotente: si el email ya es el descartable, no hace nada.

## Errores

| Situación | Comportamiento |
|---|---|
| Falla la cancelación al pedir el borrado del taller | 502, sin cambios, mensaje "No pudimos cancelar tu suscripción, reintentá o escribí a soporte" |
| Falla un paso de `purgeOrganization` | Corta, loguea el paso y reintenta en la próxima corrida |
| Webhook de MP/Rebill/Creem para una organización purgada | 200 e ignorar, para evitar reintentos en loop (verificar el comportamiento actual de cada handler) |
| ZIP que supera el tope de PDFs | Incluye los CSV, `LEEME.txt` y el listado de PDFs con links |
| Registro con un email que está en período de gracia | "Esta cuenta está en proceso de eliminación, escribí a soporte" |
| Último ADMIN pide eliminar su usuario | 409 y la UI ofrece el flujo B o transferir el rol |

## Seguridad

- Reautenticación obligatoria en los dos flujos. El rate limit de `/api/*` y el
  bloqueo de escrituras durante la impersonación del superadmin
  (`lib/impersonation.ts`) ya cubren estas rutas.
- **Concurrencia del último ADMIN.** Una función SQL bloquea con `FOR UPDATE`
  las filas ADMIN activas del taller, cuenta las que quedan sin
  `deleted_at` y marca al usuario en la misma transacción. Así dos ADMIN que se
  dan de baja a la vez no pueden dejar el taller sin ADMIN.
- **Sesiones vivas.**
  - Taller: el middleware ya bloquea a los 30 s por `deleted_at`.
  - Usuario: se invalida `refresh_token` y el callback del JWT
    (`lib/auth.ts`) rechaza a un usuario con `deleted_at`. En la
    implementación hay que medir cada cuánto revalida ese callback. Si la
    ventana es mayor a 5 minutos, se agrega el chequeo en `requireAuth`.
  - El login (`authorize`) rechaza `users.deleted_at` igual que hoy rechaza
    una organización inactiva.

## Tests (TDD estricto)

- **Unitarios.**
  - `anonymizeUser`: campos anonimizados, idempotencia.
  - `purgeOrganization`: proveedores y storage mockeados, orden de pasos,
    corte al fallar, idempotencia, recursión en subcarpetas.
  - Guarda del último ADMIN.
- **Rutas.**
  - `delete-user`: los tres roles, último ADMIN → 409, reautenticación
    fallida → 401, impersonación → bloqueada.
  - `delete-organization`: no ADMIN → 403; cancelación fallida → 502 sin
    cambios de estado; caso feliz con los campos seteados.
  - `export`: no ADMIN → 403; contenido del ZIP; tope de PDFs.
- **Auth.** Login rechazado con `users.deleted_at`; JWT rechazado al revalidar.
- **Cron.** Exige `CRON_SECRET`; dry-run por defecto; solo toma
  `deletion_requested_at` vencido y nunca archivados por inactividad.
- **Página pública.** Renderiza sin sesión desde el dominio principal y desde un
  subdominio.

## Despliegue

1. Aplicar la migración a mano con `scripts/db-run.mjs` (dry-run primero)
   **antes** del merge: el código nuevo selecciona columnas nuevas.
2. Mergear. El cron queda en dry-run.
3. Probar los dos flujos en un taller de prueba y revisar el log del cron.
4. Activar `ACCOUNT_DELETION_PURGE_ENABLED=true` en Vercel.
5. Declarar `https://stapp.com.ar/legal/eliminar-cuenta` en Play Console y
   actualizar Data Safety.

## Fuera de alcance

- Desactivar el token push al cerrar sesión (seguimiento del PR #415).
- Retención fiscal a cargo de STApp.
- Formulario público de borrado sin sesión.
- Arreglar los borrados administrativos de técnicos y vendedores, que fallan
  con historia por las FK sin `ON DELETE`. Podrían reutilizar `anonymizeUser`
  más adelante.
