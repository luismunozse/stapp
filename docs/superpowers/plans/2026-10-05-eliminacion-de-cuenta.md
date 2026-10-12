# Eliminación de cuenta (usuario y taller) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que cualquier usuario elimine su propio usuario y que un ADMIN elimine el taller completo (con respaldo descargable), con 30 días de gracia y un cron que borra de forma definitiva, más la URL pública que exige Google Play.

**Architecture:** Una migración agrega `organizations.deletion_requested_at`, `users.deleted_at` y la función SQL `solicitar_baja_usuario` (guarda del último ADMIN con `FOR UPDATE`). El borrado definitivo vive en `lib/account-deletion/*` (`purgeOrganization`, `anonymizeUser`, `cancelOrganizationSubscriptions`) y lo reutilizan el cron nuevo y la purga `?hard=true` del superadmin. Las rutas `/api/account/*` validan reautenticación y delegan; la UI es una "Zona de peligro" en `/perfil` más la página pública `/legal/eliminar-cuenta`.

**Tech Stack:** Next.js 16 App Router, NextAuth v5 (Credentials, JWT), supabase-js con `supabaseAdmin` (service role), Zod, Vitest 4 + Testing Library, `fflate` (ZIP en streaming, dependencia nueva).

**Spec:** `docs/superpowers/specs/2026-10-05-eliminacion-de-cuenta-design.md`

## Entrega en 3 PRs encadenados

Total estimado: más de 400 líneas, por eso se corta en tres slices independientes, cada uno testeable y mergeable en orden (`stacked-to-main`: PR1 a main, PR2 sobre PR1, PR3 sobre PR2; se retargetea a main al mergear el anterior).

| PR | Slice | Tareas | Líneas estimadas (src + tests) |
|---|---|---|---|
| 1 | Núcleo: migración, guarda SQL, `lib/account-deletion`, purga del superadmin, cron, auth, webhooks | 1-9 | ~950 |
| 2 | API: reauth, emails, `delete-user`, `delete-organization`, `deletion-info`, `export`, mensaje de registro | 10-18 | ~1000 |
| 3 | UI: Zona de peligro, página pública, `/legal` público, login con `callbackUrl`, enlaces en privacidad | 19-25 | ~700 |

PR1 queda por encima de 400 líneas incluso así. Si el review lo pide, se parte en **PR1a** (tareas 1-6: datos y purga, sin efecto visible) y **PR1b** (tareas 7-9: cron, auth, webhooks). Ninguna tarea depende de otra hacia atrás entre esos dos cortes salvo la 7, que consume 4 y 5.

**Orden de despliegue (del spec):** la migración 338 se aplica a mano ANTES de mergear PR1 (el código nuevo selecciona columnas nuevas). El cron queda en dry-run hasta activar `ACCOUNT_DELETION_PURGE_ENABLED=true`.

## Desvíos del spec

Cada punto es algo que el código contradice o que el spec no cubre. Está resuelto en la tarea indicada.

1. **El archivado NO bloquea el login en `lib/auth.ts`.** `authorize()` y `validateRefreshToken()` solo chequean `organizations.activo`; archivar setea `deleted_at` pero no `activo` (`app/api/superadmin/organizations/[id]/route.ts:247`). El bloqueo real lo hace el middleware por subdominio (`getTenantStatusBySlug` trata `deleted_at` como "no existe"), que no cubre el dominio apex. Tarea 8 agrega el chequeo de `deleted_at` (usuario y organización) en los tres modos de `authorize()` y en `validateRefreshToken()`.
2. **Ventana de sesión viva del usuario eliminado: hasta ~18 h.** El JWT dura 1 día y solo se revalida contra la BD en las últimas 6 h (`REFRESH_THRESHOLD`, `lib/auth.ts:40,495`); además `token.error` se setea pero ningún guard del servidor lo lee. El spec dice agregar el chequeo en `requireAuth` si la ventana pasa de 5 min. **Desvío de ubicación:** se pone en el middleware (Edge, caché de 30 s, fail-open) y no en `requireAuth`, porque cubre páginas y API con un solo punto, replica el patrón ya probado de `tenant-status-edge`, y evita un SELECT extra en cada handler y el churn en cientos de tests que mockean `requireAuth` (tarea 8).
3. **`comprobantes_fiscales.pdf_url` es un link del proveedor (TusFacturas), no un archivo en storage** (`lib/facturacion/tusfacturas-provider.ts:50`). El spec habla de "PDFs guardados en storage". El export descarga esos PDFs por HTTP con allowlist de host (`PDF_ALLOWED_HOST_SUFFIXES`), timeout, `redirect: "error"`, y los topes del spec (300 archivos / 100 MB) más un presupuesto de tiempo. Lo que no se pueda bajar va a `pdfs-pendientes.csv` con el link (tarea 16).
4. **El layout de storage no es `{orgId}/…` en todos los buckets.** `catalogo` guarda los uploads públicos bajo `sha256(orgId:NEXTAUTH_SECRET)[0..16]` (`app/api/public/catalogo/[slug]/upload/route.ts:84`); `logos` guarda logos de proveedor en `proveedores/{orgId}/`; `soporte-attachments` guarda `{ticketId}/{messageId}/…` en `lib/storage.ts:297`. Barrer solo `{orgId}/` los deja huérfanos. Tarea 3 arma la lista de prefijos completa y extrae `catalogoOrgHash`.
5. **Webhooks de cobro.** MercadoPago y Rebill responden `SKIPPED`/200 si la org no existe, pero solo miran `activo`, no `deleted_at`: un pago en vuelo durante la gracia reactivaría la suscripción. Creem no valida la org: con la org purgada el `upsert` rompe por FK, responde 500 y Creem reintenta en loop. Tarea 9.
6. **La función SQL también hace `activo = false` e invalida el `refresh_token`** en la misma transacción (el spec lo lista como pasos 2 y 3 separados). `users.activo` ya existe como "soft-disable" de técnicos y las listas lo filtran; sin esto el usuario eliminado sigue apareciendo como técnico asignable durante la gracia. Para restaurar un usuario, soporte limpia `deleted_at` **y** pone `activo = true` (tarea 1).
7. **Endpoint extra `GET /api/account/deletion-info`.** La UI necesita `slug`, `isLastAdmin`, `hasPassword` y `totpEnabled`; `/api/users/profile` no trae slug ni último ADMIN (tarea 14).
8. **El login ignora `callbackUrl`.** El middleware lo setea, pero `app/(auth)/login/page.tsx` siempre manda a `/dashboard` (líneas ~236 y ~323). Sin arreglarlo, el deep link `…/login?callbackUrl=/perfil%23eliminar` del spec no aterriza en la Zona de peligro. Tarea 21 lo corrige con un saneador anti open-redirect; es un cambio de comportamiento para todas las rutas protegidas (positivo, pero hay que decirlo en el PR).
9. **`getBaseTemplate` no está exportado** (`lib/email.ts:25`) y `@/lib/email` resuelve al archivo, no a `lib/email/index.ts`. Los emails de baja usan HTML mínimo propio e importan `sendPlatform` desde `@/lib/email/index` (tarea 11).
10. **`arrayToCSV` (`lib/csv-export.ts`) rompe números negativos** (los prefija con `'` por la mitigación de fórmulas). Para un respaldo fiscal se escribe un CSV propio que protege solo strings (tarea 15).
11. **`vercel.json` limita `app/api/**/*.ts` a 30 s**; el export necesita 60 s, así que se agrega una entrada específica (tarea 17).
12. **No hay librería ZIP en `package.json`.** Se elige `fflate` (0 dependencias, API `Zip` por chunks, ~30 KB) sobre `archiver` (depende de streams de Node) y `jszip` (arma todo en memoria) (tarea 15).
13. **Registro con email en gracia.** Al eliminar el taller los usuarios NO reciben `users.deleted_at` (solo la org), así que el chequeo del spec ("email en período de gracia") debe mirar también `organizations.deletion_requested_at` (tarea 18).
14. **Migración 338.** La última es la 337; por convención del repo el número se asigna al mergear, así que puede renumerarse si otro PR toma 338 antes.

## Global Constraints

- Sin atribución de IA en commits. Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`). Un commit por tarea.
- Por tarea: `npx tsc --noEmit` y `npx vitest run <archivos puntuales>`. **Nunca `npm run lint`** (se cuelga: ESLint recorre ~13 worktrees); usar `npx eslint <archivos>`. Nunca `npx vitest run` sin argumentos.
- `rg` siempre con paths explícitos (`rg -n "x" app lib components __tests__ supabase middleware.ts`); la raíz tiene `.env*` denegados.
- La migración se aplica a mano ANTES del merge con `node scripts/db-run.mjs <archivo>` (dry-run por default; `--apply` para commitear). Sin `BEGIN`/`COMMIT` dentro del archivo. Conexión directa puerto 5432.
- Comentarios de código y copy de UI en español (el repo es español); identificadores como el patrón mixto existente. Sin voseo rioplatense forzado en strings nuevos salvo los mensajes que el spec cita textualmente.
- Valores del spec, verbatim: gracia **30 días**; `archived_reason = 'user_requested_deletion'`; email anonimizado `deleted+{id}@deleted.stapp.invalid`; nombre `Usuario eliminado`; topes del export **300 archivos o 100 MB**; `maxDuration` **60 s**; cron dry-run salvo `ACCOUNT_DELETION_PURGE_ENABLED=true`; mensaje 502 "No pudimos cancelar tu suscripción, reintentá o escribí a soporte"; mensaje de registro "Esta cuenta está en proceso de eliminación, escribí a soporte"; URL pública `https://stapp.com.ar/legal/eliminar-cuenta`; contacto `CONTACT_EMAIL` de `lib/contact.ts`.
- Reautenticación obligatoria en los dos flujos: contraseña (usuarios `credentials`) o email tipeado (usuarios Google), más TOTP si `totp_enabled`.
- Tests de rutas: `// @vitest-environment node` al tope; helpers de `__tests__/api/helpers.ts` (`mockAuthSuccess`, `mockSupabaseFrom`, `createChainMock`, `parseResponse`). `@/lib/auth`, `@/lib/supabase` y `next/headers` ya están mockeados globalmente en `vitest.setup.ts`.

## Review Focus

Cinco entradas/fallas que el spec implica y que nadie va a probar a mano. Cada una tiene su test en la tarea indicada.

1. **Dos ADMIN se dan de baja a la vez.** El segundo debe recibir `LAST_ADMIN`/409, no dejar el taller sin ADMIN. Test de mapeo de estados en la tarea 12; la carrera real se verifica con los probes SQL y el procedimiento de dos sesiones de la tarea 1.
2. **Taller con suscripción en dos proveedores donde uno falla, y reintento.** 502 sin cambios de estado; el reintento no puede fallar porque el proveedor que sí canceló ahora responde "ya cancelada" (tareas 2 y 13).
3. **Storage con subcarpetas, más de 1000 archivos por carpeta, bucket inexistente y prefijos no-`orgId`.** Un barrido plano deja huérfanas las fotos de órdenes y el catálogo (tarea 3).
4. **Taller restaurado por el superadmin justo antes de que el cron lo purgue.** El cron no puede borrar un taller que ya no está archivado por pedido del usuario (`expectArchived`, tareas 4 y 7).
5. **Respaldo con importes negativos, strings que empiezan con `=`/`+`, más de 1000 filas y un PDF de host no permitido o redirigido.** Los negativos se conservan, las fórmulas se neutralizan, se pagina y el PDF va a `pdfs-pendientes.csv` (tareas 15 y 16).

Además, `callbackUrl` hostil (`//evil.com`, `/\evil`) en el login (tarea 21) y la visibilidad de `/legal/*` sin sesión en un subdominio (tarea 19) tienen test propio.

---

## File Structure

**Crear (PR1)**
- `supabase/migrations/338_eliminacion_de_cuenta.sql`, `supabase/migrations/rollback/338_rollback.sql`, `supabase/migrations/verify/338_probes.sql`
- `lib/account-deletion/state.ts` (constantes y predicados puros)
- `lib/account-deletion/cancel-subscriptions.ts`
- `lib/account-deletion/storage.ts` (listado recursivo, prefijos, `catalogoOrgHash`)
- `lib/account-deletion/purge-organization.ts`
- `lib/account-deletion/anonymize-user.ts`
- `lib/account-deletion/org-state.ts` (`organizationAcceptsBilling`)
- `lib/user-status-edge.ts` (chequeo Edge de usuario eliminado)
- `app/api/cron/account-deletion-purge/route.ts`
- tests: `__tests__/account-deletion-migration.test.ts`, `__tests__/lib/account-deletion/{state,cancel-subscriptions,storage,purge-organization,anonymize-user}.test.ts`, `__tests__/api/cron-account-deletion-purge.test.ts`, `__tests__/api/creem-webhook-org-borrada.test.ts`, `lib/__tests__/user-status-edge.test.ts`

**Modificar (PR1):** `lib/auth.ts`, `middleware.ts`, `app/api/superadmin/organizations/[id]/route.ts`, `app/api/superadmin/organizations/[id]/restore/route.ts`, `app/api/public/catalogo/[slug]/upload/route.ts`, `app/api/mercadopago/webhook/route.ts`, `app/api/rebill/webhook/route.ts`, `app/api/creem/webhook/route.ts`, `lib/cron-config.ts`, `vercel.json`, `__tests__/api/superadmin-organizations.test.ts`

**Crear (PR2):** `lib/account-deletion/{types,reauth,emails,export-csv,zip,export-organization}.ts`, `app/api/account/{delete-user,delete-organization,deletion-info,export}/route.ts`, tests en `__tests__/lib/account-deletion/` y `__tests__/api/account-*.test.ts`. **Modificar:** `app/api/auth/register/route.ts`, `vercel.json`, `package.json`/`package-lock.json`.

**Crear (PR3):** `lib/public-paths.ts`, `lib/safe-callback-path.ts`, `lib/account-deletion/urls.ts`, `app/legal/eliminar-cuenta/page.tsx`, `components/legal/eliminar-cuenta-form.tsx`, `components/perfil/{reauth-fields,cerrar-sesion-tras-baja,eliminar-usuario-dialog,eliminar-taller-dialog,zona-de-peligro}.tsx`. **Modificar:** `middleware.ts`, `app/(auth)/login/page.tsx`, `app/(dashboard)/perfil/page.tsx`, `app/legal/privacidad/page.tsx`.

---

# PR 1: Núcleo

### Task 1: Migración 338, guarda del último ADMIN, rollback y probes

**Files:**
- Create: `supabase/migrations/338_eliminacion_de_cuenta.sql`
- Create: `supabase/migrations/rollback/338_rollback.sql`
- Create: `supabase/migrations/verify/338_probes.sql`
- Test: `__tests__/account-deletion-migration.test.ts`

**Interfaces:**
- Consumes: tablas `organizations`, `users` (columnas `rol`, `activo`, `refresh_token`, `refresh_token_expires`, `organization_id`).
- Produces: columnas `organizations.deletion_requested_at`, `users.deleted_at`; RPC `solicitar_baja_usuario(p_user_id TEXT) RETURNS TEXT` con valores `'OK' | 'LAST_ADMIN' | 'ALREADY_DELETED' | 'NOT_FOUND'`. Forma desde supabase-js: `const { data, error } = await supabaseAdmin.rpc("solicitar_baja_usuario", { p_user_id: userId })` con `data: string`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

// Las migraciones se aplican a mano y no hay Postgres en CI: este test fija
// por texto las reglas de la guarda del último ADMIN, que es la única parte
// del diseño que vitest no puede ejecutar.
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")
const SQL = read("supabase/migrations/338_eliminacion_de_cuenta.sql")

describe("migración 338: eliminación de cuenta", () => {
  it("agrega las dos columnas y sus índices parciales", () => {
    expect(SQL).toMatch(/ALTER TABLE organizations\s+ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ/)
    expect(SQL).toMatch(/ALTER TABLE users\s+ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ/)
    expect(SQL).toMatch(/organizations_deletion_requested_at_idx[\s\S]*WHERE deletion_requested_at IS NOT NULL/)
    expect(SQL).toMatch(/users_deleted_at_idx[\s\S]*WHERE deleted_at IS NOT NULL/)
  })

  it("bloquea las filas ADMIN activas en orden estable (sin deadlock entre dos bajas)", () => {
    expect(SQL).toMatch(/rol::text = 'ADMIN'\s+AND deleted_at IS NULL\s+ORDER BY id\s+FOR UPDATE/)
  })

  it("devuelve los cuatro estados y marca al usuario en la misma transacción", () => {
    for (const estado of ["'OK'", "'LAST_ADMIN'", "'ALREADY_DELETED'", "'NOT_FOUND'"]) {
      expect(SQL).toContain(`RETURN ${estado}`)
    }
    expect(SQL).toMatch(/UPDATE users\s+SET deleted_at = now\(\),\s*activo = false,\s*refresh_token = NULL,\s*refresh_token_expires = NULL/)
  })

  it("es SECURITY DEFINER con search_path fijo y solo service_role puede ejecutarla", () => {
    expect(SQL).toMatch(/SECURITY DEFINER SET search_path = public, pg_temp/)
    expect(SQL).toMatch(/REVOKE EXECUTE ON FUNCTION solicitar_baja_usuario\(TEXT\) FROM PUBLIC/)
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION solicitar_baja_usuario\(TEXT\) TO service_role/)
  })

  it("no abre su propia transacción (db-run.mjs la maneja)", () => {
    expect(SQL).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it("el rollback deshace todo en orden inverso", () => {
    const rb = read("supabase/migrations/rollback/338_rollback.sql")
    expect(rb).toMatch(/DROP FUNCTION IF EXISTS solicitar_baja_usuario\(TEXT\)/)
    expect(rb).toMatch(/DROP COLUMN IF EXISTS deleted_at/)
    expect(rb).toMatch(/DROP COLUMN IF EXISTS deletion_requested_at/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/account-deletion-migration.test.ts`
Expected: FAIL con `ENOENT ... 338_eliminacion_de_cuenta.sql`.

- [ ] **Step 3: Write the migration, rollback and probes**

`supabase/migrations/338_eliminacion_de_cuenta.sql`:

```sql
-- 338: eliminacion de cuenta (usuario y taller) con 30 dias de gracia.
--
-- Aditiva y re-ejecutable. Sin BEGIN/COMMIT (db-run.mjs hace dry-run en una
-- transaccion propia). Las columnas nuevas son NULLABLE sin DEFAULT: no
-- reescriben la tabla.
--
-- Partes:
--   1. organizations.deletion_requested_at: distingue "el taller pidio que lo
--      borren" de "se archivo por inactividad" (auto-archive-dormant tambien
--      setea deleted_at). No se usa archived_reason porque es texto libre.
--   2. users.deleted_at: baja de un usuario. La anonimizacion ocurre a los 30
--      dias (cron account-deletion-purge).
--   3. solicitar_baja_usuario(p_user_id): da de baja a un usuario aplicando la
--      guarda del ultimo ADMIN de forma atomica.
--
-- CONCURRENCIA DE LA GUARDA: dos ADMIN que se dan de baja a la vez no pueden
-- dejar el taller sin ADMIN. La funcion bloquea TODAS las filas ADMIN activas
-- del taller en un solo statement ordenado por id (no la propia primero: dos
-- sesiones tomando primero su propia fila y despues la ajena es un deadlock).
-- La segunda sesion espera, y al despertar PostgreSQL re-evalua el predicado
-- `deleted_at IS NULL` sobre la fila que la primera ya marco: queda fuera del
-- conjunto y el conteo de "otros ADMIN" da 0 -> LAST_ADMIN.
--
-- ADEMAS de deleted_at, la baja pone activo = false (users.activo es el
-- soft-disable de tecnicos que ya filtran las listas: sin esto el usuario
-- eliminado seguiria apareciendo como asignable durante los 30 dias) y borra el
-- refresh_token (corta la renovacion de sesion).
--
-- RESTAURAR UN USUARIO (soporte, mientras no este anonimizado):
--   UPDATE users SET deleted_at = NULL, activo = true WHERE id = '...';

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

CREATE OR REPLACE FUNCTION solicitar_baja_usuario(p_user_id TEXT)
RETURNS TEXT AS $$
DECLARE
  v_org      TEXT;
  v_rol      TEXT;
  v_deleted  TIMESTAMPTZ;
  v_otros    INTEGER;
BEGIN
  SELECT organization_id, rol::text
    INTO v_org, v_rol
    FROM users
   WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;

  IF v_rol = 'ADMIN' THEN
    PERFORM id
       FROM users
      WHERE organization_id = v_org
        AND rol::text = 'ADMIN'
        AND deleted_at IS NULL
      ORDER BY id
        FOR UPDATE;
  ELSE
    PERFORM id FROM users WHERE id = p_user_id FOR UPDATE;
  END IF;

  -- Re-lectura DESPUES de tomar el lock: otra sesion pudo marcarlo mientras esperabamos.
  SELECT deleted_at INTO v_deleted FROM users WHERE id = p_user_id;
  IF v_deleted IS NOT NULL THEN
    RETURN 'ALREADY_DELETED';
  END IF;

  IF v_rol = 'ADMIN' THEN
    SELECT count(*) INTO v_otros
      FROM users
     WHERE organization_id = v_org
       AND rol::text = 'ADMIN'
       AND deleted_at IS NULL
       AND id <> p_user_id;

    IF v_otros = 0 THEN
      RETURN 'LAST_ADMIN';
    END IF;
  END IF;

  UPDATE users
     SET deleted_at = now(),
         activo = false,
         refresh_token = NULL,
         refresh_token_expires = NULL
   WHERE id = p_user_id;

  RETURN 'OK';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION solicitar_baja_usuario(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION solicitar_baja_usuario(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION solicitar_baja_usuario(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION solicitar_baja_usuario(TEXT) TO service_role;
```

`supabase/migrations/rollback/338_rollback.sql`:

```sql
-- Rollback de la migracion 338.
--
-- OJO: descarta los pedidos de eliminacion en curso (deletion_requested_at y
-- users.deleted_at). Las organizaciones ya archivadas por pedido del usuario
-- siguen archivadas (deleted_at de organizations no se toca), pero el cron
-- deja de saber cuales vencen. Correr solo si no hay pedidos vigentes.

DROP FUNCTION IF EXISTS solicitar_baja_usuario(TEXT);

DROP INDEX IF EXISTS users_deleted_at_idx;
DROP INDEX IF EXISTS organizations_deletion_requested_at_idx;

ALTER TABLE users DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE organizations DROP COLUMN IF EXISTS deletion_requested_at;
```

`supabase/migrations/verify/338_probes.sql`:

```sql
-- Probes de la migracion 338: guarda del ultimo ADMIN.
--
-- Correr en el SQL editor de Supabase Studio tal cual (BEGIN / ROLLBACK
-- incluidos). Requiere la 338 aplicada. Verde = esperado igual a obtenido.
--
-- NO cubre la carrera real entre dos sesiones (una sola transaccion no puede
-- probarla). Procedimiento manual en un taller de prueba con dos ADMIN A y B:
--   Sesion 1: BEGIN; SELECT solicitar_baja_usuario('<A>');   -- sin commit
--   Sesion 2: SELECT solicitar_baja_usuario('<B>');          -- debe QUEDAR ESPERANDO
--   Sesion 1: COMMIT;
--   Sesion 2: debe devolver 'LAST_ADMIN'.
BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

DO $$
DECLARE
  v_org TEXT; v_a TEXT; v_b TEXT; v_res TEXT; v_activo BOOLEAN; v_rt TEXT;
BEGIN
  SELECT id INTO v_org FROM organizations ORDER BY created_at LIMIT 1;
  IF v_org IS NULL THEN
    INSERT INTO _r VALUES (0, 'setup', 'una org', 'SALTEADO: la base no tiene organizations');
    RETURN;
  END IF;

  BEGIN
    INSERT INTO users (email, nombre, rol, organization_id, refresh_token)
      VALUES ('probe-a-338@example.invalid', 'Probe A', 'ADMIN', v_org, 'tok-a') RETURNING id INTO v_a;
    INSERT INTO users (email, nombre, rol, organization_id)
      VALUES ('probe-b-338@example.invalid', 'Probe B', 'ADMIN', v_org) RETURNING id INTO v_b;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES (0, 'setup', 'dos ADMIN de prueba', 'SALTEADO: ' || SQLERRM);
    RETURN;
  END;

  -- Se deja a A y B como unicos ADMIN activos: el resto de la org queda fuera del conteo.
  UPDATE users SET deleted_at = now()
   WHERE organization_id = v_org AND rol::text = 'ADMIN' AND id NOT IN (v_a, v_b) AND deleted_at IS NULL;

  v_res := solicitar_baja_usuario(v_a);
  INSERT INTO _r VALUES (1, 'A se da de baja con B presente', 'OK', v_res);

  SELECT activo, refresh_token INTO v_activo, v_rt FROM users WHERE id = v_a;
  INSERT INTO _r VALUES (2, 'A queda activo=false', 'false', v_activo::text);
  INSERT INTO _r VALUES (3, 'A pierde el refresh_token', 'null', COALESCE(v_rt, 'null'));

  v_res := solicitar_baja_usuario(v_b);
  INSERT INTO _r VALUES (4, 'B es el ultimo ADMIN', 'LAST_ADMIN', v_res);

  v_res := solicitar_baja_usuario(v_a);
  INSERT INTO _r VALUES (5, 'A repetido', 'ALREADY_DELETED', v_res);

  v_res := solicitar_baja_usuario('no-existe-338');
  INSERT INTO _r VALUES (6, 'id inexistente', 'NOT_FOUND', v_res);
END $$;

SELECT orden, probe, esperado, obtenido, (esperado = obtenido) AS ok FROM _r ORDER BY orden;

ROLLBACK;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/account-deletion-migration.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/338_eliminacion_de_cuenta.sql supabase/migrations/rollback/338_rollback.sql supabase/migrations/verify/338_probes.sql __tests__/account-deletion-migration.test.ts
git commit -m "feat(db): columnas de baja y guarda del ultimo admin para eliminar cuenta"
```

---

### Task 2: Constantes de estado y cancelación de suscripciones

**Files:**
- Create: `lib/account-deletion/state.ts`
- Create: `lib/account-deletion/cancel-subscriptions.ts`
- Test: `__tests__/lib/account-deletion/state.test.ts`
- Test: `__tests__/lib/account-deletion/cancel-subscriptions.test.ts`

**Interfaces:**
- Consumes: `cancelPreApproval(id: string)` (`lib/mercadopago`), `cancelRebillSubscription(id: string)` (`lib/rebill`), `cancelCreemSubscription(id: string): Promise<void>` (`lib/creem`); tabla `subscriptions` (`canceled_at`, `mercadopago_preapproval_id`, `rebill_subscription_id`, `creem_subscription_id`).
- Produces:
  - `state.ts`: `GRACE_DAYS = 30`, `ANON_EMAIL_DOMAIN`, `ANON_NAME`, `DELETION_REASON`, `anonymizedEmail(id): string`, `isAnonymizedEmail(email): boolean`, `graceEndsAt(from: Date | string): Date`, `graceCutoff(now?: Date): Date`, `isUserDeleted(u): boolean`, `isOrgDeleted(o): boolean`.
  - `cancel-subscriptions.ts`: `type CancelResult = { ok: true; canceled: string[]; skipped: boolean } | { ok: false; failed: string[]; canceled: string[] }`; `cancelOrganizationSubscriptions(organizationId: string): Promise<CancelResult>`; `isAlreadyCanceledError(err: unknown): boolean`.

- [ ] **Step 1: Write the failing tests**

`__tests__/lib/account-deletion/state.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  GRACE_DAYS, anonymizedEmail, isAnonymizedEmail, graceEndsAt, graceCutoff, isUserDeleted, isOrgDeleted,
} from "@/lib/account-deletion/state"

describe("account-deletion/state", () => {
  it("la gracia es de 30 días", () => {
    expect(GRACE_DAYS).toBe(30)
  })

  it("arma y reconoce el email descartable", () => {
    expect(anonymizedEmail("abc123")).toBe("deleted+abc123@deleted.stapp.invalid")
    expect(isAnonymizedEmail("deleted+abc123@deleted.stapp.invalid")).toBe(true)
    expect(isAnonymizedEmail("juan@gmail.com")).toBe(false)
    expect(isAnonymizedEmail(null)).toBe(false)
  })

  it("graceEndsAt suma 30 días en UTC", () => {
    expect(graceEndsAt("2026-10-05T12:00:00.000Z").toISOString()).toBe("2026-11-04T12:00:00.000Z")
  })

  it("graceCutoff resta 30 días", () => {
    expect(graceCutoff(new Date("2026-11-04T12:00:00.000Z")).toISOString()).toBe("2026-10-05T12:00:00.000Z")
  })

  it("isUserDeleted / isOrgDeleted miran deleted_at y toleran null/undefined", () => {
    expect(isUserDeleted({ deleted_at: "2026-10-05T00:00:00Z" })).toBe(true)
    expect(isUserDeleted({ deleted_at: null })).toBe(false)
    expect(isUserDeleted(undefined)).toBe(false)
    expect(isOrgDeleted({ deleted_at: "x" })).toBe(true)
    expect(isOrgDeleted(null)).toBe(false)
  })
})
```

`__tests__/lib/account-deletion/cancel-subscriptions.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom } from "../../api/helpers"

vi.mock("@/lib/mercadopago", () => ({ cancelPreApproval: vi.fn() }))
vi.mock("@/lib/rebill", () => ({ cancelRebillSubscription: vi.fn() }))
vi.mock("@/lib/creem", () => ({ cancelCreemSubscription: vi.fn() }))

import { cancelPreApproval } from "@/lib/mercadopago"
import { cancelRebillSubscription } from "@/lib/rebill"
import { cancelCreemSubscription } from "@/lib/creem"
import { cancelOrganizationSubscriptions, isAlreadyCanceledError } from "@/lib/account-deletion/cancel-subscriptions"

const sub = (over: Record<string, unknown> = {}) => ({
  id: "s1", canceled_at: null,
  mercadopago_preapproval_id: null, rebill_subscription_id: null, creem_subscription_id: null,
  ...over,
})

describe("cancelOrganizationSubscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("sin fila de suscripción no hay nada que cancelar", async () => {
    mockSupabaseFrom({ subscriptions: createChainMock(null, null) })
    expect(await cancelOrganizationSubscriptions("o1")).toEqual({ ok: true, canceled: [], skipped: true })
  })

  it("si ya tiene canceled_at no vuelve a llamar a los proveedores", async () => {
    mockSupabaseFrom({ subscriptions: createChainMock(sub({ canceled_at: "2026-10-01", mercadopago_preapproval_id: "pre1" })) })
    const r = await cancelOrganizationSubscriptions("o1")
    expect(r).toEqual({ ok: true, canceled: [], skipped: true })
    expect(cancelPreApproval).not.toHaveBeenCalled()
  })

  it("cancela en cada proveedor con id", async () => {
    mockSupabaseFrom({ subscriptions: createChainMock(sub({ mercadopago_preapproval_id: "pre1", rebill_subscription_id: "rb1" })) })
    const r = await cancelOrganizationSubscriptions("o1")
    expect(r).toEqual({ ok: true, canceled: ["MERCADOPAGO", "REBILL"], skipped: false })
    expect(cancelPreApproval).toHaveBeenCalledWith("pre1")
    expect(cancelRebillSubscription).toHaveBeenCalledWith("rb1")
    expect(cancelCreemSubscription).not.toHaveBeenCalled()
  })

  it("si uno falla intenta igual los demás y devuelve cuáles fallaron", async () => {
    mockSupabaseFrom({ subscriptions: createChainMock(sub({ mercadopago_preapproval_id: "pre1", rebill_subscription_id: "rb1" })) })
    vi.mocked(cancelRebillSubscription).mockRejectedValueOnce(new Error("boom"))
    const r = await cancelOrganizationSubscriptions("o1")
    expect(r).toEqual({ ok: false, failed: ["REBILL"], canceled: ["MERCADOPAGO"] })
  })

  it("'ya cancelada' cuenta como éxito (reintento tras un fallo parcial)", async () => {
    mockSupabaseFrom({ subscriptions: createChainMock(sub({ mercadopago_preapproval_id: "pre1" })) })
    vi.mocked(cancelPreApproval).mockRejectedValueOnce(new Error("Cannot modify a cancelled preapproval"))
    const r = await cancelOrganizationSubscriptions("o1")
    expect(r).toEqual({ ok: true, canceled: ["MERCADOPAGO"], skipped: false })
  })

  it("un error de lectura de la BD es un fallo, no 'no hay suscripción'", async () => {
    mockSupabaseFrom({ subscriptions: createChainMock(null, { message: "down" }) })
    expect(await cancelOrganizationSubscriptions("o1")).toEqual({ ok: false, failed: ["DB"], canceled: [] })
  })
})

describe("isAlreadyCanceledError", () => {
  it.each([
    ["Cannot modify a cancelled preapproval", true],
    ["subscription already canceled", true],
    ["la suscripción ya está cancelada", true],
    ["timeout de red", false],
    ["401 unauthorized", false],
  ])("%s -> %s", (msg, esperado) => {
    expect(isAlreadyCanceledError(new Error(msg))).toBe(esperado)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/account-deletion/state.test.ts __tests__/lib/account-deletion/cancel-subscriptions.test.ts`
Expected: FAIL con "Failed to resolve import @/lib/account-deletion/state".

- [ ] **Step 3: Write minimal implementation**

`lib/account-deletion/state.ts`:

```ts
// Constantes y predicados puros de la eliminación de cuenta. Sin imports de
// servidor: lo consumen auth, middleware (Edge), rutas, cron y UI.

/** Días entre el pedido y el borrado definitivo. */
export const GRACE_DAYS = 30

/** Dominio reservado (.invalid, RFC 2606): nunca puede recibir correo. */
export const ANON_EMAIL_DOMAIN = "deleted.stapp.invalid"
export const ANON_NAME = "Usuario eliminado"

/** Valor de organizations.archived_reason cuando el pedido lo hizo el taller. */
export const DELETION_REASON = "user_requested_deletion"

export function anonymizedEmail(userId: string): string {
  return `deleted+${userId}@${ANON_EMAIL_DOMAIN}`
}

export function isAnonymizedEmail(email: string | null | undefined): boolean {
  return !!email && email.endsWith(`@${ANON_EMAIL_DOMAIN}`)
}

/** Fecha en que vence la gracia de un pedido hecho en `from`. */
export function graceEndsAt(from: Date | string): Date {
  const d = new Date(from)
  d.setUTCDate(d.getUTCDate() + GRACE_DAYS)
  return d
}

/** Pedidos hechos antes de esta fecha ya cumplieron la gracia. */
export function graceCutoff(now: Date = new Date()): Date {
  const d = new Date(now)
  d.setUTCDate(d.getUTCDate() - GRACE_DAYS)
  return d
}

export function isUserDeleted(u: { deleted_at?: string | null } | null | undefined): boolean {
  return !!u?.deleted_at
}

export function isOrgDeleted(o: { deleted_at?: string | null } | null | undefined): boolean {
  return !!o?.deleted_at
}
```

`lib/account-deletion/cancel-subscriptions.ts`:

```ts
import { supabaseAdmin } from "@/lib/supabase"
import { cancelPreApproval } from "@/lib/mercadopago"
import { cancelRebillSubscription } from "@/lib/rebill"
import { cancelCreemSubscription } from "@/lib/creem"

export type CancelResult =
  | { ok: true; canceled: string[]; skipped: boolean }
  | { ok: false; failed: string[]; canceled: string[] }

/**
 * Un reintento después de un fallo parcial vuelve a llamar al proveedor que ya
 * canceló. Ese rechazo no es un error real. Heurística sobre el mensaje: el
 * texto exacto de MercadoPago/Rebill se confirma en la prueba manual con un
 * taller de prueba; si no matchea, el resultado es un 502 reintentable.
 */
export function isAlreadyCanceledError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /(already|ya)\s+(is\s+|est[aá]\s+)?cancel/i.test(msg) || /cannot (modify|update).*cancel/i.test(msg)
}

/**
 * Cancela la suscripción de la organización en cada proveedor con id. Aísla
 * fallos (un id viejo de otro proveedor no frena al que cobra) y es idempotente:
 * si `canceled_at` ya está seteado no toca a los proveedores.
 */
export async function cancelOrganizationSubscriptions(organizationId: string): Promise<CancelResult> {
  const { data: sub, error } = await supabaseAdmin
    .from("subscriptions")
    .select("id, canceled_at, mercadopago_preapproval_id, rebill_subscription_id, creem_subscription_id")
    .eq("organization_id", organizationId)
    .maybeSingle()

  if (error) return { ok: false, failed: ["DB"], canceled: [] }
  if (!sub || sub.canceled_at) return { ok: true, canceled: [], skipped: true }

  const jobs: Array<[string, () => Promise<unknown>]> = []
  if (sub.mercadopago_preapproval_id) jobs.push(["MERCADOPAGO", () => cancelPreApproval(sub.mercadopago_preapproval_id)])
  if (sub.rebill_subscription_id) jobs.push(["REBILL", () => cancelRebillSubscription(sub.rebill_subscription_id)])
  if (sub.creem_subscription_id) jobs.push(["CREEM", () => cancelCreemSubscription(sub.creem_subscription_id)])

  const canceled: string[] = []
  const failed: string[] = []
  for (const [proveedor, cancelar] of jobs) {
    try {
      await cancelar()
      canceled.push(proveedor)
    } catch (err) {
      if (isAlreadyCanceledError(err)) {
        canceled.push(proveedor)
      } else {
        console.error(`[account-deletion] error cancelando en ${proveedor}:`, err)
        failed.push(proveedor)
      }
    }
  }

  return failed.length > 0 ? { ok: false, failed, canceled } : { ok: true, canceled, skipped: false }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/account-deletion/state.test.ts __tests__/lib/account-deletion/cancel-subscriptions.test.ts` y `npx tsc --noEmit`
Expected: PASS; tsc sin errores.

- [ ] **Step 5: Commit**

```bash
git add lib/account-deletion/state.ts lib/account-deletion/cancel-subscriptions.ts __tests__/lib/account-deletion/state.test.ts __tests__/lib/account-deletion/cancel-subscriptions.test.ts
git commit -m "feat(account-deletion): estado de baja y cancelacion de suscripciones"
```

---

### Task 3: Storage — listado recursivo, prefijos y hash del catálogo

**Files:**
- Create: `lib/account-deletion/storage.ts`
- Modify: `app/api/public/catalogo/[slug]/upload/route.ts` (usar `catalogoOrgHash`)
- Test: `__tests__/lib/account-deletion/storage.test.ts`

**Interfaces:**
- Consumes: `supabaseAdmin.storage.from(bucket).list(dir, { limit, offset })` (las carpetas vienen con `id: null`), `.remove(paths[])`; `STORAGE_BUCKETS` de `lib/supabase`; tabla `support_tickets(id, organization_id)`.
- Produces:
  - `PROVEEDOR_ADJUNTOS_BUCKET = "proveedor-adjuntos"`, `PURGE_BUCKETS: string[]`
  - `catalogoOrgHash(orgId: string): string`
  - `listAllFiles(bucket: string, prefix: string): Promise<string[]>`
  - `removePrefix(bucket: string, prefix: string, deadline?: number): Promise<number>` (devuelve archivos borrados; tira si pasa `deadline` o si falla el borrado; un bucket inexistente cuenta como vacío)
  - `storageTargets(orgId: string): Promise<Array<{ bucket: string; prefix: string }>>`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import crypto from "crypto"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock, mockSupabaseFrom } from "../../api/helpers"
import {
  PURGE_BUCKETS, catalogoOrgHash, listAllFiles, removePrefix, storageTargets,
} from "@/lib/account-deletion/storage"

type Entry = { name: string; id: string | null }
/** tree["bucket:dir"] = entradas de esa carpeta (id null = subcarpeta). */
function mockStorage(tree: Record<string, Entry[]>, removeFn = vi.fn().mockResolvedValue({ data: null, error: null })) {
  vi.mocked(supabaseAdmin.storage.from).mockImplementation(((bucket: string) => ({
    list: vi.fn(async (dir: string, opts: { limit: number; offset: number }) => {
      if (tree[`${bucket}:__missing__`]) return { data: null, error: { message: "Bucket not found" } }
      return { data: (tree[`${bucket}:${dir}`] ?? []).slice(opts.offset, opts.offset + opts.limit), error: null }
    }),
    remove: removeFn,
  })) as never)
  return removeFn
}

describe("catalogoOrgHash", () => {
  it("replica la fórmula del upload público (sha256 de orgId:secret, 16 hex)", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "s3cret")
    const esperado = crypto.createHash("sha256").update("org-1:s3cret").digest("hex").slice(0, 16)
    expect(catalogoOrgHash("org-1")).toBe(esperado)
    expect(catalogoOrgHash("org-1")).toHaveLength(16)
  })
})

describe("PURGE_BUCKETS", () => {
  it("incluye proveedor-adjuntos y excluye los APK (no son de la org)", () => {
    expect(PURGE_BUCKETS).toContain("proveedor-adjuntos")
    expect(PURGE_BUCKETS).toContain("fotos-ordenes")
    expect(PURGE_BUCKETS).not.toContain("apk-releases")
  })
})

describe("listAllFiles", () => {
  it("recorre subcarpetas (fotos-ordenes/{org}/{orden}/archivo)", async () => {
    mockStorage({
      "b:org": [{ name: "ord1", id: null }, { name: "logo.png", id: "x" }],
      "b:org/ord1": [{ name: "a.jpg", id: "1" }, { name: "deep", id: null }],
      "b:org/ord1/deep": [{ name: "b.jpg", id: "2" }],
    })
    expect((await listAllFiles("b", "org")).sort()).toEqual(["org/logo.png", "org/ord1/a.jpg", "org/ord1/deep/b.jpg"])
  })

  it("pagina cuando una carpeta tiene más de 1000 entradas", async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({ name: `f${i}.jpg`, id: String(i) }))
    mockStorage({ "b:org": many })
    expect(await listAllFiles("b", "org")).toHaveLength(2500)
  })
})

describe("removePrefix", () => {
  it("borra en tandas de 100 y devuelve el total", async () => {
    const files = Array.from({ length: 250 }, (_, i) => ({ name: `f${i}`, id: String(i) }))
    const removeFn = mockStorage({ "b:org": files })
    expect(await removePrefix("b", "org")).toBe(250)
    expect(removeFn).toHaveBeenCalledTimes(3)
    expect(removeFn.mock.calls[0][0]).toHaveLength(100)
  })

  it("un bucket inexistente cuenta como vacío (csv-imports se crea de forma lazy)", async () => {
    mockStorage({ "b:__missing__": [] })
    expect(await removePrefix("b", "org")).toBe(0)
  })

  it("si falla el borrado tira, para que el paso quede marcado como fallido", async () => {
    mockStorage({ "b:org": [{ name: "a", id: "1" }] }, vi.fn().mockResolvedValue({ data: null, error: { message: "denied" } }))
    await expect(removePrefix("b", "org")).rejects.toThrow(/denied/)
  })

  it("corta al pasar el deadline (el cron reintenta mañana)", async () => {
    const files = Array.from({ length: 250 }, (_, i) => ({ name: `f${i}`, id: String(i) }))
    mockStorage({ "b:org": files })
    await expect(removePrefix("b", "org", Date.now() - 1)).rejects.toThrow(/deadline/)
  })
})

describe("storageTargets", () => {
  beforeEach(() => vi.stubEnv("NEXTAUTH_SECRET", "s3cret"))

  it("cubre {orgId} en todos los buckets, proveedores/, el hash del catálogo y cada ticket de soporte", async () => {
    mockSupabaseFrom({ support_tickets: createChainMock([{ id: "t1" }, { id: "t2" }], null) })
    const targets = await storageTargets("org-1")
    expect(targets).toContainEqual({ bucket: "fotos-ordenes", prefix: "org-1" })
    expect(targets).toContainEqual({ bucket: "proveedor-adjuntos", prefix: "org-1" })
    expect(targets).toContainEqual({ bucket: "logos", prefix: "proveedores/org-1" })
    expect(targets).toContainEqual({ bucket: "catalogo", prefix: catalogoOrgHash("org-1") })
    expect(targets).toContainEqual({ bucket: "soporte-attachments", prefix: "t1" })
    expect(targets).toContainEqual({ bucket: "soporte-attachments", prefix: "t2" })
  })

  it("si no se pueden leer los tickets tira (no se puede garantizar el barrido)", async () => {
    mockSupabaseFrom({ support_tickets: createChainMock(null, { message: "down" }) })
    await expect(storageTargets("org-1")).rejects.toThrow(/support_tickets/)
  })
})

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/account-deletion/storage.test.ts`
Expected: FAIL con "Failed to resolve import @/lib/account-deletion/storage".

- [ ] **Step 3: Write minimal implementation**

`lib/account-deletion/storage.ts`:

```ts
import crypto from "crypto"
import { supabaseAdmin, STORAGE_BUCKETS } from "@/lib/supabase"

// Este bucket no está en STORAGE_BUCKETS: lo usa app/api/proveedores/[id]/adjuntos.
export const PROVEEDOR_ADJUNTOS_BUCKET = "proveedor-adjuntos"

// Todos los buckets con archivos de una organización. Los APK son de la
// plataforma, no de ningún taller.
export const PURGE_BUCKETS: string[] = [
  ...Object.values(STORAGE_BUCKETS).filter((b) => b !== STORAGE_BUCKETS.APK_RELEASES),
  PROVEEDOR_ADJUNTOS_BUCKET,
]

/**
 * Prefijo con el que el upload PÚBLICO del catálogo guarda los archivos, para
 * no exponer el organization_id en la URL. Misma fórmula que
 * app/api/public/catalogo/[slug]/upload/route.ts (que ahora la importa de acá).
 * Si NEXTAUTH_SECRET rota, los archivos anteriores quedan bajo el hash viejo y
 * no se pueden recalcular: es una limitación aceptada.
 */
export function catalogoOrgHash(orgId: string): string {
  return crypto
    .createHash("sha256")
    .update(`${orgId}:${process.env.NEXTAUTH_SECRET || "stapp"}`)
    .digest("hex")
    .slice(0, 16)
}

const PAGE = 1000
const REMOVE_CHUNK = 100

function isMissingBucket(message: string): boolean {
  return /not found/i.test(message)
}

/**
 * Lista TODOS los archivos bajo `prefix`, recorriendo subcarpetas y paginando.
 * En storage de Supabase las carpetas vienen sin `id` (`id: null`) y `list` no
 * es recursivo: un barrido plano de `{orgId}/` se saltea `{orgId}/{ordenId}/…`.
 */
export async function listAllFiles(bucket: string, prefix: string): Promise<string[]> {
  const files: string[] = []
  const pending = [prefix]
  while (pending.length > 0) {
    const dir = pending.pop() as string
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabaseAdmin.storage.from(bucket).list(dir, { limit: PAGE, offset })
      if (error) throw new Error(`storage list (${bucket}/${dir}): ${error.message}`)
      const entries = data ?? []
      for (const entry of entries) {
        const full = `${dir}/${entry.name}`
        if (entry.id === null) pending.push(full)
        else files.push(full)
      }
      if (entries.length < PAGE) break
    }
  }
  return files
}

/** Borra todo lo que hay bajo `prefix`. Devuelve cuántos archivos borró. */
export async function removePrefix(bucket: string, prefix: string, deadline?: number): Promise<number> {
  let files: string[]
  try {
    files = await listAllFiles(bucket, prefix)
  } catch (err) {
    if (err instanceof Error && isMissingBucket(err.message)) return 0
    throw err
  }

  let removed = 0
  for (let i = 0; i < files.length; i += REMOVE_CHUNK) {
    if (deadline !== undefined && Date.now() > deadline) {
      throw new Error(`deadline excedido borrando ${bucket}/${prefix} (${removed}/${files.length})`)
    }
    const chunk = files.slice(i, i + REMOVE_CHUNK)
    const { error } = await supabaseAdmin.storage.from(bucket).remove(chunk)
    if (error) throw new Error(`storage remove (${bucket}): ${error.message}`)
    removed += chunk.length
  }
  return removed
}

/** Todos los (bucket, prefijo) donde una organización puede tener archivos. */
export async function storageTargets(orgId: string): Promise<Array<{ bucket: string; prefix: string }>> {
  const targets = PURGE_BUCKETS.map((bucket) => ({ bucket, prefix: orgId }))
  targets.push({ bucket: STORAGE_BUCKETS.LOGOS, prefix: `proveedores/${orgId}` })
  targets.push({ bucket: STORAGE_BUCKETS.CATALOGO, prefix: catalogoOrgHash(orgId) })

  // soporte-attachments se organiza por ticket ({ticketId}/{messageId}/…), no por org.
  // Los ids hay que leerlos ANTES de borrar la fila de la org (los tickets caen en cascada).
  const { data: tickets, error } = await supabaseAdmin
    .from("support_tickets")
    .select("id")
    .eq("organization_id", orgId)
  if (error) throw new Error(`support_tickets: ${error.message}`)
  for (const t of tickets ?? []) targets.push({ bucket: STORAGE_BUCKETS.SOPORTE_ATTACHMENTS, prefix: t.id })

  return targets
}
```

En `app/api/public/catalogo/[slug]/upload/route.ts` reemplazar el bloque inline `const orgHash = crypto.createHash("sha256")...digest("hex").slice(0, 16)` por:

```ts
  const orgHash = catalogoOrgHash(config.organization_id)
```

y agregar `import { catalogoOrgHash } from "@/lib/account-deletion/storage"`. `crypto` se sigue usando (`crypto.randomBytes`), no se toca su import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/account-deletion/storage.test.ts`, luego `npx vitest run $(rg -l "catalogo/\[slug\]/upload" __tests__)` y `npx tsc --noEmit`.
Expected: PASS; tsc sin errores.

- [ ] **Step 5: Commit**

```bash
git add lib/account-deletion/storage.ts "app/api/public/catalogo/[slug]/upload/route.ts" __tests__/lib/account-deletion/storage.test.ts
git commit -m "feat(account-deletion): barrido recursivo de storage y prefijos por organizacion"
```

---

### Task 4: `purgeOrganization`

**Files:**
- Create: `lib/account-deletion/purge-organization.ts`
- Test: `__tests__/lib/account-deletion/purge-organization.test.ts`

**Interfaces:**
- Consumes: `cancelOrganizationSubscriptions(orgId): Promise<CancelResult>` (tarea 2); `storageTargets`, `removePrefix` (tarea 3).
- Produces:
  ```ts
  export type PurgeStep = "precheck" | "subscriptions" | "storage" | "database"
  export interface PurgeOptions { deadline?: number; expectArchived?: boolean }
  export type PurgeResult =
    | { ok: true; removedFiles: number; skipped?: "not-found" | "not-archived" }
    | { ok: false; step: PurgeStep; error: string }
  export function purgeOrganization(orgId: string, opts?: PurgeOptions): Promise<PurgeResult>
  ```
  Pasos en orden: precheck (solo con `expectArchived`) → suscripciones → storage → fila de `organizations` (el resto cae en cascada). Cada paso es idempotente; si uno falla corta y devuelve el paso.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom } from "../../api/helpers"

vi.mock("@/lib/account-deletion/cancel-subscriptions", () => ({ cancelOrganizationSubscriptions: vi.fn() }))
vi.mock("@/lib/account-deletion/storage", () => ({ storageTargets: vi.fn(), removePrefix: vi.fn() }))

import { cancelOrganizationSubscriptions } from "@/lib/account-deletion/cancel-subscriptions"
import { storageTargets, removePrefix } from "@/lib/account-deletion/storage"
import { purgeOrganization } from "@/lib/account-deletion/purge-organization"

const orden: string[] = []

function setup(opts: { cancel?: unknown; org?: unknown; deleteError?: unknown } = {}) {
  orden.length = 0
  vi.mocked(cancelOrganizationSubscriptions).mockImplementation(async () => {
    orden.push("cancel")
    return (opts.cancel ?? { ok: true, canceled: [], skipped: true }) as never
  })
  vi.mocked(storageTargets).mockResolvedValue([
    { bucket: "fotos-ordenes", prefix: "o1" },
    { bucket: "logos", prefix: "proveedores/o1" },
  ])
  vi.mocked(removePrefix).mockImplementation(async (bucket) => {
    orden.push(`storage:${bucket}`)
    return 2
  })
  const orgChain = createChainMock(opts.org === undefined ? { id: "o1", deleted_at: "2026-09-01", deletion_requested_at: "2026-09-01" } : opts.org, null)
  orgChain.delete = vi.fn(() => {
    orden.push("db")
    return createChainMock(null, opts.deleteError ?? null)
  }) as never
  mockSupabaseFrom({ organizations: orgChain })
  return orgChain
}

describe("purgeOrganization", () => {
  beforeEach(() => vi.clearAllMocks())

  it("ejecuta suscripciones, storage y fila de la org, en ese orden", async () => {
    setup()
    const r = await purgeOrganization("o1")
    expect(r).toEqual({ ok: true, removedFiles: 4 })
    expect(orden).toEqual(["cancel", "storage:fotos-ordenes", "storage:logos", "db"])
  })

  it("si falla la cancelación corta: no toca storage ni la fila", async () => {
    setup({ cancel: { ok: false, failed: ["REBILL"], canceled: [] } })
    const r = await purgeOrganization("o1")
    expect(r).toMatchObject({ ok: false, step: "subscriptions" })
    expect(removePrefix).not.toHaveBeenCalled()
    expect(orden).not.toContain("db")
  })

  it("si falla storage corta: la fila de la org sigue ahí para reintentar mañana", async () => {
    setup()
    vi.mocked(removePrefix).mockRejectedValueOnce(new Error("denied"))
    const r = await purgeOrganization("o1")
    expect(r).toMatchObject({ ok: false, step: "storage", error: expect.stringContaining("denied") })
    expect(orden).not.toContain("db")
  })

  it("si falla el delete de la fila lo informa como paso database", async () => {
    setup({ deleteError: { message: "fk" } })
    expect(await purgeOrganization("o1")).toMatchObject({ ok: false, step: "database" })
  })

  it("pasa el deadline a removePrefix", async () => {
    setup()
    await purgeOrganization("o1", { deadline: 123 })
    expect(vi.mocked(removePrefix).mock.calls[0][2]).toBe(123)
  })

  describe("expectArchived (lo usa el cron)", () => {
    it("no purga un taller que el superadmin restauró entre la selección y la purga", async () => {
      setup({ org: { id: "o1", deleted_at: null, deletion_requested_at: null } })
      const r = await purgeOrganization("o1", { expectArchived: true })
      expect(r).toEqual({ ok: true, removedFiles: 0, skipped: "not-archived" })
      expect(cancelOrganizationSubscriptions).not.toHaveBeenCalled()
      expect(removePrefix).not.toHaveBeenCalled()
    })

    it("un taller archivado por inactividad (sin deletion_requested_at) tampoco se purga", async () => {
      setup({ org: { id: "o1", deleted_at: "2026-01-01", deletion_requested_at: null } })
      expect(await purgeOrganization("o1", { expectArchived: true })).toMatchObject({ skipped: "not-archived" })
    })

    it("un taller que ya no existe es éxito (idempotencia)", async () => {
      setup({ org: null })
      expect(await purgeOrganization("o1", { expectArchived: true })).toEqual({ ok: true, removedFiles: 0, skipped: "not-found" })
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/account-deletion/purge-organization.test.ts`
Expected: FAIL con "Failed to resolve import @/lib/account-deletion/purge-organization".

- [ ] **Step 3: Write minimal implementation**

```ts
import { supabaseAdmin } from "@/lib/supabase"
import { cancelOrganizationSubscriptions } from "./cancel-subscriptions"
import { removePrefix, storageTargets } from "./storage"

export type PurgeStep = "precheck" | "subscriptions" | "storage" | "database"

export interface PurgeOptions {
  /** Timestamp (ms) a partir del cual no se empiezan más borrados de storage. */
  deadline?: number
  /**
   * Solo purgar si la org sigue archivada POR PEDIDO del usuario. Lo pasa el
   * cron: entre que selecciona el candidato y lo purga, el superadmin pudo
   * restaurarlo. La purga manual del superadmin no lo usa.
   */
  expectArchived?: boolean
}

export type PurgeResult =
  | { ok: true; removedFiles: number; skipped?: "not-found" | "not-archived" }
  | { ok: false; step: PurgeStep; error: string }

const fail = (step: PurgeStep, error: string): PurgeResult => ({ ok: false, step, error })

/**
 * Borrado definitivo de una organización: cancela la suscripción en cada
 * proveedor, vacía storage (recursivo, todos los buckets) y borra la fila
 * (el resto cae en cascada). Cada paso es idempotente; ante un fallo corta y
 * devuelve el paso, y el caller (cron) reintenta en la próxima corrida.
 */
export async function purgeOrganization(orgId: string, opts: PurgeOptions = {}): Promise<PurgeResult> {
  if (opts.expectArchived) {
    const { data: org, error } = await supabaseAdmin
      .from("organizations")
      .select("id, deleted_at, deletion_requested_at")
      .eq("id", orgId)
      .maybeSingle()
    if (error) return fail("precheck", error.message)
    if (!org) return { ok: true, removedFiles: 0, skipped: "not-found" }
    if (!org.deleted_at || !org.deletion_requested_at) return { ok: true, removedFiles: 0, skipped: "not-archived" }
  }

  const cancel = await cancelOrganizationSubscriptions(orgId)
  if (!cancel.ok) return fail("subscriptions", `no se pudo cancelar en: ${cancel.failed.join(", ")}`)

  let removedFiles = 0
  try {
    for (const { bucket, prefix } of await storageTargets(orgId)) {
      removedFiles += await removePrefix(bucket, prefix, opts.deadline)
    }
  } catch (err) {
    return fail("storage", err instanceof Error ? err.message : String(err))
  }

  let del = supabaseAdmin.from("organizations").delete().eq("id", orgId)
  if (opts.expectArchived) del = del.not("deleted_at", "is", null)
  const { error: deleteError } = await del
  if (deleteError) return fail("database", deleteError.message)

  return { ok: true, removedFiles }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/account-deletion/purge-organization.test.ts` y `npx tsc --noEmit`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/account-deletion/purge-organization.ts __tests__/lib/account-deletion/purge-organization.test.ts
git commit -m "feat(account-deletion): purgeOrganization idempotente con corte por paso"
```

---

### Task 5: `anonymizeUser`

**Files:**
- Create: `lib/account-deletion/anonymize-user.ts`
- Test: `__tests__/lib/account-deletion/anonymize-user.test.ts`

**Interfaces:**
- Consumes: `anonymizedEmail`, `isAnonymizedEmail`, `ANON_NAME` (tarea 2); `STORAGE_BUCKETS.AVATARS` (los avatares viven en `{orgId}/{userId}.{ext}`, ver `lib/storage.ts`); tablas `users`, `totp_used_codes`, `push_tokens`, `web_push_subscriptions`, `audit_logs`.
- Produces: `anonymizeUser(userId: string): Promise<{ ok: true; alreadyAnonymized: boolean } | { ok: false; error: string }>`. Idempotente: el UPDATE de `users` va **último**, así un fallo a mitad de camino se reintenta completo (si fuera primero, el email descartable haría creer que ya terminó).

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock, mockSupabaseFrom } from "../../api/helpers"
import { anonymizeUser } from "@/lib/account-deletion/anonymize-user"

function setup(userRow: unknown) {
  const users = createChainMock(userRow, null)
  const totp = createChainMock(null, null)
  const push = createChainMock(null, null)
  const web = createChainMock(null, null)
  const audit = createChainMock(null, null)
  mockSupabaseFrom({ users, totp_used_codes: totp, push_tokens: push, web_push_subscriptions: web, audit_logs: audit })
  const remove = vi.fn().mockResolvedValue({ data: null, error: null })
  vi.mocked(supabaseAdmin.storage.from).mockReturnValue({
    list: vi.fn().mockResolvedValue({ data: [{ name: "u1.png" }, { name: "u10.png" }], error: null }),
    remove,
  } as never)
  return { users, totp, push, web, audit, remove }
}

describe("anonymizeUser", () => {
  beforeEach(() => vi.clearAllMocks())

  it("anonimiza los datos personales y conserva la fila", async () => {
    const { users } = setup({ id: "u1", email: "juan@gmail.com", organization_id: "o1" })
    expect(await anonymizeUser("u1")).toEqual({ ok: true, alreadyAnonymized: false })
    expect(users.update).toHaveBeenCalledWith(expect.objectContaining({
      email: "deleted+u1@deleted.stapp.invalid",
      nombre: "Usuario eliminado",
      password: null,
      telefono: null,
      avatar_url: null,
      refresh_token: null,
      refresh_token_expires: null,
      reset_token: null,
      email_verification_token: null,
      totp_enabled: false,
      totp_secret: null,
      totp_backup_codes: null,
    }))
    expect(users.delete).not.toHaveBeenCalled()
  })

  it("borra el avatar de storage (solo el archivo exacto del usuario, no u10.png)", async () => {
    const { remove } = setup({ id: "u1", email: "juan@gmail.com", organization_id: "o1" })
    await anonymizeUser("u1")
    expect(remove).toHaveBeenCalledWith(["o1/u1.png"])
  })

  it("borra totp_used_codes y tokens push, y limpia ip/user-agent de la auditoría sin borrarla", async () => {
    const { totp, push, web, audit } = setup({ id: "u1", email: "juan@gmail.com", organization_id: "o1" })
    await anonymizeUser("u1")
    expect(totp.delete).toHaveBeenCalled()
    expect(push.delete).toHaveBeenCalled()
    expect(web.delete).toHaveBeenCalled()
    expect(audit.update).toHaveBeenCalledWith({ ip_address: null, user_agent: null })
    expect(audit.delete).not.toHaveBeenCalled()
  })

  it("el UPDATE de users va después de todas las limpiezas (para poder reintentar)", async () => {
    const { users, totp, push, web, audit } = setup({ id: "u1", email: "juan@gmail.com", organization_id: "o1" })
    await anonymizeUser("u1")
    const updateOrder = users.update.mock.invocationCallOrder[0]
    for (const previo of [totp.delete, push.delete, web.delete, audit.update]) {
      expect(previo.mock.invocationCallOrder[0]).toBeLessThan(updateOrder)
    }
  })

  it("es idempotente: si el email ya es el descartable no hace nada", async () => {
    const { users, remove } = setup({ id: "u1", email: "deleted+u1@deleted.stapp.invalid", organization_id: "o1" })
    expect(await anonymizeUser("u1")).toEqual({ ok: true, alreadyAnonymized: true })
    expect(users.update).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it("si falla una limpieza devuelve el error y NO anonimiza el email", async () => {
    const { users, push } = setup({ id: "u1", email: "juan@gmail.com", organization_id: "o1" })
    push.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "locked" } }).then(resolve)
    const r = await anonymizeUser("u1")
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("push_tokens") })
    expect(users.update).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/account-deletion/anonymize-user.test.ts`
Expected: FAIL con "Failed to resolve import @/lib/account-deletion/anonymize-user".

- [ ] **Step 3: Write minimal implementation**

```ts
import { supabaseAdmin, STORAGE_BUCKETS } from "@/lib/supabase"
import { ANON_NAME, anonymizedEmail, isAnonymizedEmail } from "./state"

export type AnonymizeResult =
  | { ok: true; alreadyAnonymized: boolean }
  | { ok: false; error: string }

function must(label: string, res: { error: { message: string } | null } | null | undefined) {
  if (res?.error) throw new Error(`${label}: ${res.error.message}`)
}

// Avatar: {orgId}/{userId}.{ext}. El filtro por `${userId}.` evita borrar el de
// otro usuario cuyo id empiece igual (list usa búsqueda por substring).
async function removeAvatarFiles(organizationId: string, userId: string) {
  const bucket = supabaseAdmin.storage.from(STORAGE_BUCKETS.AVATARS)
  const { data, error } = await bucket.list(organizationId, { search: userId })
  if (error) {
    if (/not found/i.test(error.message)) return
    throw new Error(`avatar list: ${error.message}`)
  }
  const paths = (data ?? [])
    .filter((f) => f.name.startsWith(`${userId}.`))
    .map((f) => `${organizationId}/${f.name}`)
  if (paths.length === 0) return
  const { error: rmError } = await bucket.remove(paths)
  if (rmError) throw new Error(`avatar remove: ${rmError.message}`)
}

/**
 * Anonimiza a un usuario dado de baja hace más de 30 días. La fila NO se borra:
 * ventas, caja, órdenes y cuenta corriente la referencian con FK sin ON DELETE.
 * Las operaciones quedan firmadas como "Usuario eliminado".
 */
export async function anonymizeUser(userId: string): Promise<AnonymizeResult> {
  try {
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("id, email, organization_id")
      .eq("id", userId)
      .maybeSingle()
    if (error) return { ok: false, error: error.message }
    if (!user || isAnonymizedEmail(user.email)) return { ok: true, alreadyAnonymized: true }

    await removeAvatarFiles(user.organization_id, userId)
    must("totp_used_codes", await supabaseAdmin.from("totp_used_codes").delete().eq("user_id", userId))
    must("push_tokens", await supabaseAdmin.from("push_tokens").delete().eq("user_id", userId))
    must("web_push_subscriptions", await supabaseAdmin.from("web_push_subscriptions").delete().eq("user_id", userId))
    must("audit_logs", await supabaseAdmin.from("audit_logs").update({ ip_address: null, user_agent: null }).eq("user_id", userId))

    // Último: es lo que marca "ya terminó" para la idempotencia.
    must(
      "users",
      await supabaseAdmin
        .from("users")
        .update({
          email: anonymizedEmail(userId),
          nombre: ANON_NAME,
          password: null,
          telefono: null,
          avatar_url: null,
          refresh_token: null,
          refresh_token_expires: null,
          reset_token: null,
          reset_token_expiry: null,
          email_verification_token: null,
          email_verification_expires: null,
          totp_enabled: false,
          totp_secret: null,
          totp_backup_codes: null,
          totp_verified_at: null,
          activo: false,
        })
        .eq("id", userId)
    )
    return { ok: true, alreadyAnonymized: false }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/account-deletion/anonymize-user.test.ts` y `npx tsc --noEmit`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/account-deletion/anonymize-user.ts __tests__/lib/account-deletion/anonymize-user.test.ts
git commit -m "feat(account-deletion): anonymizeUser idempotente que conserva la fila"
```

---

### Task 6: Purga del superadmin reutiliza `purgeOrganization`; restore limpia la columna

**Files:**
- Modify: `app/api/superadmin/organizations/[id]/route.ts` (bloque "Hard purge", líneas ~300-330)
- Modify: `app/api/superadmin/organizations/[id]/restore/route.ts` (UPDATE de restauración)
- Modify: `__tests__/api/superadmin-organizations.test.ts`

**Interfaces:**
- Consumes: `purgeOrganization(orgId): Promise<PurgeResult>` (tarea 4).
- Produces: `DELETE ...?hard=true` ahora cancela suscripciones, vacía todo storage y borra la fila; ante un fallo responde 502 (paso `subscriptions`) o 500 (otro paso) con `{ error, step }`. `restore` pone `deletion_requested_at: null`.

- [ ] **Step 1: Write the failing tests**

En `__tests__/api/superadmin-organizations.test.ts`: el test existente "hard-purges when hard=true and confirmSlug matches" ahora recorre `purgeOrganization` real, que lee `subscriptions` y `support_tickets`. Reemplazar su `mockSupabaseFrom` por:

```ts
    mockSupabaseFrom({
      organizations: orgChain as any,
      audit_logs: createChainMock(null, null),
      subscriptions: createChainMock(null, null),
      support_tickets: createChainMock([], null),
    })
```

y agregar, dentro del mismo `describe` de DELETE:

```ts
  it("la purga hard cancela la suscripción antes de borrar: si el proveedor falla responde 502 y no borra", async () => {
    const orgChain = {
      ...createChainMock({ id: "o1", nombre: "GuruTech", slug: "guru-tech", deleted_at: null }),
      delete: vi.fn().mockReturnValue(createChainMock(null, null)),
    }
    // suscripción con id de Rebill; el mock de lib/rebill se define arriba del archivo
    mockSupabaseFrom({
      organizations: orgChain as any,
      audit_logs: createChainMock(null, null),
      subscriptions: createChainMock({ id: "s1", canceled_at: null, rebill_subscription_id: "rb1" }, null),
      support_tickets: createChainMock([], null),
    })
    vi.mocked(cancelRebillSubscription).mockRejectedValueOnce(new Error("rebill down"))
    vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await DELETE(
      req("http://localhost/api/superadmin/organizations/o1?hard=true", { confirmSlug: "guru-tech" }),
      ctx("o1")
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(502)
    expect(body.step).toBe("subscriptions")
    expect(orgChain.delete).not.toHaveBeenCalled()
  })
```

Arriba del archivo, junto al `vi.mock("@/lib/superadmin-auth", ...)`, agregar:

```ts
vi.mock("@/lib/mercadopago", () => ({ cancelPreApproval: vi.fn() }))
vi.mock("@/lib/rebill", () => ({ cancelRebillSubscription: vi.fn() }))
vi.mock("@/lib/creem", () => ({ cancelCreemSubscription: vi.fn() }))
import { cancelRebillSubscription } from "@/lib/rebill"
```

Y en el test de restore, ampliar la aserción del payload:

```ts
    expect(payload).toEqual(
      expect.objectContaining({ deleted_at: null, deleted_by: null, archived_reason: null, deletion_requested_at: null })
    )
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/api/superadmin-organizations.test.ts`
Expected: FAIL: el 502 devuelve 200 (el código viejo no cancela) y falta `deletion_requested_at` en el restore.

- [ ] **Step 3: Write minimal implementation**

En `app/api/superadmin/organizations/[id]/route.ts`, agregar `import { purgeOrganization } from "@/lib/account-deletion/purge-organization"` y reemplazar TODO el bloque desde el comentario `// Limpiar archivos de storage (best effort)` hasta el `if (deleteError) {...}` inclusive por:

```ts
    // Cancela la suscripción en el proveedor, vacía storage (recursivo, todos
    // los buckets) y borra la fila. Antes esto solo barría 6 buckets a un nivel
    // y no cancelaba el cobro: un taller pago purgado seguía cobrándose.
    const purge = await purgeOrganization(id)
    if (!purge.ok) {
      console.error(`Error purging organization ${id} (paso ${purge.step}):`, purge.error)
      return NextResponse.json(
        { error: `Error al eliminar la organización (paso: ${purge.step})`, step: purge.step },
        { status: purge.step === "subscriptions" ? 502 : 500 }
      )
    }
```

`STORAGE_BUCKETS` sigue importado: lo usa `calculateRealStorageMb`.

En `restore/route.ts`, cambiar el update a:

```ts
      .update({ deleted_at: null, deleted_by: null, archived_reason: null, deletion_requested_at: null })
```

y actualizar el docstring: "limpia deleted_at/deleted_by/archived_reason/deletion_requested_at. La suscripción cancelada NO se reactiva: el taller vuelve a suscribirse."

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/api/superadmin-organizations.test.ts __tests__/api/superadmin-organization-detail.test.ts` y `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/api/superadmin/organizations/[id]/route.ts" "app/api/superadmin/organizations/[id]/restore/route.ts" __tests__/api/superadmin-organizations.test.ts
git commit -m "fix(superadmin): la purga hard cancela suscripcion y vacia todo storage"
```

---

### Task 7: Cron `account-deletion-purge` (dry-run por defecto)

**Files:**
- Create: `app/api/cron/account-deletion-purge/route.ts`
- Modify: `vercel.json` (agregar el cron), `lib/cron-config.ts` (agregar la definición)
- Test: `__tests__/api/cron-account-deletion-purge.test.ts`

**Interfaces:**
- Consumes: `requireCronAuth(request): NextResponse | null` (`lib/cron-auth`); `graceCutoff`, `ANON_EMAIL_DOMAIN`, `DELETION_REASON` (tarea 2); `purgeOrganization(orgId, { deadline, expectArchived })` (tarea 4); `anonymizeUser(userId)` (tarea 5).
- Produces: `GET /api/cron/account-deletion-purge` → `{ success: true, results: { dryRun, orgs: { candidates, purged, skipped, failed: Array<{ id, step, error }> }, users: { candidates, anonymized, failed: Array<{ id, error }> } }, timestamp }`. Es dry-run salvo `ACCOUNT_DELETION_PURGE_ENABLED=true` (se lee en cada request, no al importar el módulo, para poder testearlo).

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/account-deletion/purge-organization", () => ({ purgeOrganization: vi.fn() }))
vi.mock("@/lib/account-deletion/anonymize-user", () => ({ anonymizeUser: vi.fn() }))

import { purgeOrganization } from "@/lib/account-deletion/purge-organization"
import { anonymizeUser } from "@/lib/account-deletion/anonymize-user"
import { GET } from "@/app/api/cron/account-deletion-purge/route"

const NOW = new Date("2026-11-10T05:30:00.000Z")
const CUTOFF = "2026-10-11T05:30:00.000Z" // NOW - 30 días

const req = (auth = "Bearer s3cret") =>
  new Request("http://localhost/api/cron/account-deletion-purge", { headers: { authorization: auth } })

function setup(orgs: unknown[], users: unknown[]) {
  const organizations = createChainMock(orgs, null)
  const usersChain = createChainMock(users, null)
  mockSupabaseFrom({ organizations, users: usersChain, audit_logs: createChainMock(null, null) })
  return { organizations, usersChain }
}

describe("GET /api/cron/account-deletion-purge", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(NOW)
    vi.stubEnv("CRON_SECRET", "s3cret")
    vi.stubEnv("ACCOUNT_DELETION_PURGE_ENABLED", "")
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(purgeOrganization).mockResolvedValue({ ok: true, removedFiles: 3 })
    vi.mocked(anonymizeUser).mockResolvedValue({ ok: true, alreadyAnonymized: false })
  })
  afterEach(() => vi.useRealTimers())

  it("exige CRON_SECRET", async () => {
    expect((await GET(req("Bearer otro"))).status).toBe(401)
    expect(purgeOrganization).not.toHaveBeenCalled()
  })

  it("por defecto es dry-run: informa candidatos y no borra nada", async () => {
    setup([{ id: "o1", slug: "uno" }], [{ id: "u1" }])
    const { status, body } = await parseResponse(await GET(req()))
    expect(status).toBe(200)
    expect(body.results.dryRun).toBe(true)
    expect(body.results.orgs.candidates).toBe(1)
    expect(body.results.users.candidates).toBe(1)
    expect(purgeOrganization).not.toHaveBeenCalled()
    expect(anonymizeUser).not.toHaveBeenCalled()
  })

  it("solo toma pedidos de eliminación vencidos y nunca los archivados por inactividad", async () => {
    const { organizations, usersChain } = setup([], [])
    await GET(req())
    expect(organizations.not).toHaveBeenCalledWith("deletion_requested_at", "is", null)
    expect(organizations.lt).toHaveBeenCalledWith("deletion_requested_at", CUTOFF)
    expect(organizations.not).toHaveBeenCalledWith("deleted_at", "is", null)
    expect(usersChain.lt).toHaveBeenCalledWith("deleted_at", CUTOFF)
    expect(usersChain.not).toHaveBeenCalledWith("email", "like", "%@deleted.stapp.invalid")
  })

  it("con ACCOUNT_DELETION_PURGE_ENABLED=true purga con expectArchived y anonimiza", async () => {
    vi.stubEnv("ACCOUNT_DELETION_PURGE_ENABLED", "true")
    setup([{ id: "o1", slug: "uno" }], [{ id: "u1" }])
    const { body } = await parseResponse(await GET(req()))
    expect(body.results.dryRun).toBe(false)
    expect(body.results.orgs.purged).toBe(1)
    expect(body.results.users.anonymized).toBe(1)
    expect(purgeOrganization).toHaveBeenCalledWith("o1", expect.objectContaining({ expectArchived: true, deadline: expect.any(Number) }))
    expect(anonymizeUser).toHaveBeenCalledWith("u1")
  })

  it("un taller restaurado en el medio se cuenta como saltado, no como purgado", async () => {
    vi.stubEnv("ACCOUNT_DELETION_PURGE_ENABLED", "true")
    setup([{ id: "o1", slug: "uno" }], [])
    vi.mocked(purgeOrganization).mockResolvedValueOnce({ ok: true, removedFiles: 0, skipped: "not-archived" })
    const { body } = await parseResponse(await GET(req()))
    expect(body.results.orgs).toMatchObject({ purged: 0, skipped: 1 })
  })

  it("un taller que falla no frena a los demás y queda registrado con su paso", async () => {
    vi.stubEnv("ACCOUNT_DELETION_PURGE_ENABLED", "true")
    setup([{ id: "o1", slug: "uno" }, { id: "o2", slug: "dos" }], [])
    vi.mocked(purgeOrganization)
      .mockResolvedValueOnce({ ok: false, step: "storage", error: "denied" })
      .mockResolvedValueOnce({ ok: true, removedFiles: 1 })
    const { body } = await parseResponse(await GET(req()))
    expect(body.results.orgs.purged).toBe(1)
    expect(body.results.orgs.failed).toEqual([{ id: "o1", step: "storage", error: "denied" }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/cron-account-deletion-purge.test.ts`
Expected: FAIL con "Failed to resolve import @/app/api/cron/account-deletion-purge/route".

- [ ] **Step 3: Write minimal implementation**

`app/api/cron/account-deletion-purge/route.ts`:

```ts
import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { requireCronAuth } from "@/lib/cron-auth"
import { ANON_EMAIL_DOMAIN, DELETION_REASON, graceCutoff } from "@/lib/account-deletion/state"
import { purgeOrganization } from "@/lib/account-deletion/purge-organization"
import { anonymizeUser } from "@/lib/account-deletion/anonymize-user"

export const maxDuration = 60

// Lotes acotados para respetar los 60 s. Lo que no entra hoy entra mañana.
const ORG_BATCH = 5
const USER_BATCH = 50
const BUDGET_MS = 45_000

// Interruptor de seguridad, leído en cada request. Mientras no sea "true" el
// cron es DRY RUN: informa candidatos y no cancela, borra ni anonimiza nada.
const isEnabled = () => process.env.ACCOUNT_DELETION_PURGE_ENABLED === "true"

export async function GET(request: Request) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  try {
    const now = new Date()
    const deadline = now.getTime() + BUDGET_MS
    const cutoff = graceCutoff(now).toISOString()
    const dryRun = !isEnabled()

    const results = {
      dryRun,
      orgs: { candidates: 0, purged: 0, skipped: 0, failed: [] as Array<{ id: string; step: string; error: string }> },
      users: { candidates: 0, anonymized: 0, failed: [] as Array<{ id: string; error: string }> },
    }

    // Talleres: pedido de eliminación vencido Y todavía archivado. Los archivados
    // por inactividad (auto-archive-dormant) no tienen deletion_requested_at.
    const { data: orgs, error: orgsError } = await supabaseAdmin
      .from("organizations")
      .select("id, slug")
      .not("deletion_requested_at", "is", null)
      .lt("deletion_requested_at", cutoff)
      .not("deleted_at", "is", null)
      .order("deletion_requested_at", { ascending: true })
      .limit(ORG_BATCH)
    if (orgsError) throw new Error(`organizations: ${orgsError.message}`)
    results.orgs.candidates = (orgs ?? []).length

    // Usuarios: baja vencida y todavía sin anonimizar.
    const { data: users, error: usersError } = await supabaseAdmin
      .from("users")
      .select("id")
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff)
      .not("email", "like", `%@${ANON_EMAIL_DOMAIN}`)
      .order("deleted_at", { ascending: true })
      .limit(USER_BATCH)
    if (usersError) throw new Error(`users: ${usersError.message}`)
    results.users.candidates = (users ?? []).length

    if (!dryRun) {
      for (const org of orgs ?? []) {
        if (Date.now() >= deadline) break
        const r = await purgeOrganization(org.id, { deadline, expectArchived: true })
        console.log(JSON.stringify({ cron: "account-deletion-purge", kind: "org", id: org.id, slug: org.slug, result: r }))
        if (!r.ok) {
          results.orgs.failed.push({ id: org.id, step: r.step, error: r.error })
        } else if (r.skipped) {
          results.orgs.skipped++
        } else {
          results.orgs.purged++
          // La fila de la org ya no existe: el log queda sin organization_id, igual que la purga manual.
          await supabaseAdmin.from("audit_logs").insert({
            organization_id: null,
            user_id: null,
            action: "DELETE",
            entity: "organizations",
            entity_id: org.id,
            changes: { auto: true, reason: DELETION_REASON, slug: org.slug, removed_files: r.removedFiles },
          })
        }
      }

      for (const user of users ?? []) {
        if (Date.now() >= deadline) break
        const r = await anonymizeUser(user.id)
        console.log(JSON.stringify({ cron: "account-deletion-purge", kind: "user", id: user.id, result: r }))
        if (r.ok) results.users.anonymized++
        else results.users.failed.push({ id: user.id, error: r.error })
      }
    }

    return NextResponse.json({ success: true, results, timestamp: now.toISOString() })
  } catch (error) {
    console.error("Error en cron account-deletion-purge:", error)
    return NextResponse.json({ error: "Error procesando eliminaciones de cuenta" }, { status: 500 })
  }
}
```

En `vercel.json`, agregar al final del arreglo `crons` (después de `auto-archive-dormant`, con coma):

```json
    {
      "path": "/api/cron/account-deletion-purge",
      "schedule": "30 5 * * *"
    }
```

En `lib/cron-config.ts`, agregar al final de `CRON_JOBS`:

```ts
  {
    id: "account-deletion-purge",
    name: "Account Deletion Purge",
    path: "/api/cron/account-deletion-purge",
    schedule: "5:30 AM",
    description: "Borra talleres y anonimiza usuarios dados de baja hace más de 30 días (dry-run salvo ACCOUNT_DELETION_PURGE_ENABLED=true)",
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/api/cron-account-deletion-purge.test.ts`, `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))"` y `npx tsc --noEmit`
Expected: PASS (6 tests); el JSON parsea sin error.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/account-deletion-purge/route.ts vercel.json lib/cron-config.ts __tests__/api/cron-account-deletion-purge.test.ts
git commit -m "feat(cron): purga diaria de talleres y usuarios dados de baja (dry-run por defecto)"
```

---

### Task 8: Auth rechaza usuarios y talleres dados de baja; chequeo Edge de sesiones vivas

**Files:**
- Create: `lib/user-status-edge.ts`
- Modify: `lib/auth.ts` (imports, `validateRefreshToken`, Modo 2 Google, Modo 3 credenciales)
- Modify: `middleware.ts`
- Test: `lib/__tests__/user-status-edge.test.ts`, `__tests__/lib/account-deletion/auth-contract.test.ts`

**Interfaces:**
- Consumes: `isUserDeleted`, `isOrgDeleted` (tarea 2); env `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Produces: `getUserDeletedStatus(userId: string): Promise<{ kind: "ok"; deleted: boolean } | { kind: "error" }>` (caché 30 s, fail-open) y `clearUserStatusCache(): void` (solo tests). `authorize()` devuelve `null` (o `GOOGLE_NO_ACCOUNT`) para usuarios con `deleted_at` y para organizaciones con `deleted_at` (superadmin exento del chequeo de org). `validateRefreshToken` devuelve `null` en ambos casos.

`lib/auth.ts` está mockeado globalmente en vitest (importActual rompe por `next-auth`), así que el cableado de `authorize` se fija con un test de contrato sobre el texto fuente, más `tsc` y la prueba manual de la tarea de despliegue.

- [ ] **Step 1: Write the failing tests**

`lib/__tests__/user-status-edge.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { getUserDeletedStatus, clearUserStatusCache } from "@/lib/user-status-edge"

const row = (r: unknown) => new Response(JSON.stringify(r), { status: 200 })

describe("getUserDeletedStatus", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    clearUserStatusCache()
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key"
  })

  it("deleted:true cuando users.deleted_at está seteado", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(row([{ deleted_at: "2026-10-05T00:00:00Z" }]))
    expect(await getUserDeletedStatus("u1")).toEqual({ kind: "ok", deleted: true })
  })

  it("deleted:false para un usuario normal y para una fila inexistente", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(row([{ deleted_at: null }]))
    expect(await getUserDeletedStatus("u2")).toEqual({ kind: "ok", deleted: false })
    vi.spyOn(global, "fetch").mockResolvedValue(row([]))
    expect(await getUserDeletedStatus("u3")).toEqual({ kind: "ok", deleted: false })
  })

  it("cachea 30 s: la segunda consulta no pega a Supabase", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(row([{ deleted_at: null }]))
    await getUserDeletedStatus("u4")
    await getUserDeletedStatus("u4")
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("fail-open: si Supabase falla devuelve error (el middleware deja pasar) y no cachea", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("x", { status: 500 }))
    expect(await getUserDeletedStatus("u5")).toEqual({ kind: "error" })
    await getUserDeletedStatus("u5")
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it("sin env devuelve error", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(await getUserDeletedStatus("u6")).toEqual({ kind: "error" })
  })

  it("codifica el id en la URL", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(row([]))
    await getUserDeletedStatus("a&b=c")
    expect(String(spy.mock.calls[0][0])).toContain("id=eq.a%26b%3Dc")
  })
})
```

`__tests__/lib/account-deletion/auth-contract.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

// lib/auth.ts no se puede importar en vitest (next-auth no carga y está mockeado
// globalmente), así que se fija por texto que cada puerta de entrada consulta
// la baja. Si alguien agrega un cuarto modo de login, este test es el recordatorio.
const src = readFileSync(join(process.cwd(), "lib/auth.ts"), "utf8")
const count = (re: RegExp) => (src.match(re) ?? []).length

describe("lib/auth.ts rechaza cuentas dadas de baja", () => {
  it("chequea users.deleted_at en refresh token, Google y credenciales", () => {
    expect(count(/isUserDeleted\(/g)).toBeGreaterThanOrEqual(3)
  })

  it("chequea organizations.deleted_at en refresh token, Google y credenciales", () => {
    expect(count(/isOrgDeleted\(/g)).toBeGreaterThanOrEqual(3)
  })

  it("los tres SELECT de organización piden deleted_at", () => {
    expect(count(/organizations \(id, activo, deleted_at\)/g)).toBe(1)
    expect(count(/id,\s*activo,\s*deleted_at/g)).toBeGreaterThanOrEqual(3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/__tests__/user-status-edge.test.ts __tests__/lib/account-deletion/auth-contract.test.ts`
Expected: FAIL (módulo inexistente y conteos en 0).

- [ ] **Step 3: Write minimal implementation**

`lib/user-status-edge.ts` (sin imports de servidor, apto para Edge; gemelo de `tenant-status-edge.ts`):

```ts
// Estado de baja de un usuario, seguro para Edge runtime (middleware).
// Hace fetch directo al REST de Supabase con el service role key, con caché en
// memoria de 30 s. El JWT de un usuario dado de baja sigue siendo válido hasta
// ~18 h (solo se revalida contra la BD en las últimas 6 h de su día de vida),
// así que esto es lo que corta la sesión viva.

export type UserStatusLookup = { kind: "ok"; deleted: boolean } | { kind: "error" }

const store = new Map<string, { deleted: boolean; expiresAt: number }>()
const TTL_MS = 30_000

export function clearUserStatusCache(): void {
  store.clear()
}

export async function getUserDeletedStatus(userId: string): Promise<UserStatusLookup> {
  const now = Date.now()
  const hit = store.get(userId)
  if (hit && hit.expiresAt > now) return { kind: "ok", deleted: hit.deleted }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return { kind: "error" }

  const url = `${base}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=deleted_at&limit=1`
  try {
    const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    if (!res.ok) return { kind: "error" } // no se cachea: reintenta en el próximo request
    const rows = (await res.json()) as Array<{ deleted_at: string | null }>
    // Fila inexistente = no se puede afirmar que fue dado de baja: no se corta la sesión.
    const deleted = !!rows[0]?.deleted_at
    store.set(userId, { deleted, expiresAt: now + TTL_MS })
    return { kind: "ok", deleted }
  } catch {
    return { kind: "error" }
  }
}
```

`middleware.ts`: agregar el import junto a los demás:

```ts
import { getUserDeletedStatus } from "@/lib/user-status-edge"
```

e insertar este bloque justo ANTES del comentario `// Read-only impersonation enforcement. When a superadmin impersonates a`:

```ts
  // Usuario dado de baja (eliminación de cuenta): su JWT sigue siendo válido
  // hasta ~18 h porque solo se revalida en las últimas 6 h de su día de vida.
  // Mismo patrón que el estado del tenant: caché de 30 s y fail-open si
  // Supabase no responde. Impersonación y rutas públicas quedan fuera
  // (/api/auth tiene que seguir andando para poder cerrar sesión).
  if (token?.id && !token.isImpersonating && !isPublicPath(pathname)) {
    const userStatus = await getUserDeletedStatus(token.id as string)
    if (userStatus.kind === "ok" && userStatus.deleted) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Cuenta eliminada" }, { status: 401 })
      }
      return NextResponse.redirect(new URL("/login", request.url))
    }
  }

```

`lib/auth.ts`, cinco ediciones:

1. Import, después de `import { verifyUserTotpCode } from "@/lib/totp"`:
```ts
import { isUserDeleted, isOrgDeleted } from "@/lib/account-deletion/state"
```

2. `validateRefreshToken`: en el SELECT cambiar `refresh_token_expires,\n      organizations (id, activo)` por:
```ts
      refresh_token_expires,
      deleted_at,
      organizations (id, activo, deleted_at)
```
y después de `if (error || !user) return null` (el de esa función) agregar:
```ts
  // Usuario dado de baja: no renueva sesión ni entra por el refresh token de la PWA.
  if (isUserDeleted(user)) return null
```
y reemplazar la línea `if (!isSuperadminEmail(user.email) && (!org || !(org as { activo: boolean }).activo)) return null` por:
```ts
  if (
    !isSuperadminEmail(user.email) &&
    (!org || !(org as { activo: boolean }).activo || isOrgDeleted(org as { deleted_at?: string | null }))
  ) return null
```

3. Modo 2 (Google): en el SELECT de `organizations (\n                id,\n                activo\n              )` que precede a `.eq("email", googleEmailNormalized)` agregar una línea `deleted_at` después de `activo` (con coma). Después del bloque `if (gError || !gUser) { throw new AuthSigninError("GOOGLE_NO_ACCOUNT") }` agregar:
```ts
          // Baja en período de gracia: se comporta como cuenta inexistente.
          if (isUserDeleted(gUser)) {
            throw new AuthSigninError("GOOGLE_NO_ACCOUNT")
          }
```
y reemplazar:
```ts
          const gOrg = gUser.organizations as { id: string; activo: boolean } | null
          if (!isGoogleSuper && !gOrg?.activo) {
```
por:
```ts
          const gOrg = gUser.organizations as { id: string; activo: boolean; deleted_at?: string | null } | null
          if (!isGoogleSuper && (!gOrg?.activo || isOrgDeleted(gOrg))) {
```

4. Modo 3 (credenciales): igual, agregar `deleted_at` al SELECT de organización que precede a `.eq("email", normalizedEmail)`. Después del bloque `if (error || !user) {... return null }` y antes de `// Verificar account lockout` agregar:
```ts
        // Baja en período de gracia: mismo resultado que una credencial inválida,
        // sin revelar que la cuenta existe.
        if (isUserDeleted(user)) {
          logLoginEvent({
            userId: user.id,
            email: user.email,
            success: false,
            isSuperadmin: isSuperadminEmail(user.email),
            reason: "Usuario eliminado",
          }).catch(() => {})
          return null
        }
```
y reemplazar:
```ts
        const organization = user.organizations as { id: string; activo: boolean } | null
        if (!isSuper && !organization?.activo) {
```
por:
```ts
        const organization = user.organizations as { id: string; activo: boolean; deleted_at?: string | null } | null
        if (!isSuper && (!organization?.activo || isOrgDeleted(organization))) {
```

Nota: el Modo 1 (refresh token de la PWA) queda cubierto por `validateRefreshToken`, que ya llama a `authorize` antes de leer `fullUser`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/user-status-edge.test.ts __tests__/lib/account-deletion/auth-contract.test.ts lib/__tests__/tenant-status-edge.test.ts` y `npx tsc --noEmit`
Expected: PASS; tsc sin errores. Verificar a mano: `rg -n "isUserDeleted\(|isOrgDeleted\(" lib/auth.ts` muestra 3+3 usos.

- [ ] **Step 5: Commit**

```bash
git add lib/user-status-edge.ts lib/auth.ts middleware.ts lib/__tests__/user-status-edge.test.ts __tests__/lib/account-deletion/auth-contract.test.ts
git commit -m "feat(auth): rechazar usuarios y talleres dados de baja y cortar sesiones vivas"
```

---

### Task 9: Webhooks de cobro no resucitan ni rompen una organización dada de baja

**Files:**
- Create: `lib/account-deletion/org-state.ts`
- Modify: `app/api/mercadopago/webhook/route.ts` (líneas ~320-324 y handler de preapproval ~636)
- Modify: `app/api/rebill/webhook/route.ts` (líneas ~180-184)
- Modify: `app/api/creem/webhook/route.ts` (`handleCheckoutCompleted`, `handleSubscriptionActivate`, `handleSubscriptionPaid`)
- Test: `__tests__/lib/account-deletion/org-state.test.ts`, `__tests__/api/creem-webhook-org-borrada.test.ts`, ampliar `__tests__/api/mercadopago-webhook-duplicado.test.ts`

**Interfaces:**
- Consumes: tabla `organizations(id, deleted_at)`.
- Produces: `organizationAcceptsBilling(orgId: string): Promise<boolean>` — `false` si la org no existe o tiene `deleted_at`; tira si la lectura falla (el webhook responde 500 y el proveedor reintenta, que es lo correcto ante un error transitorio). Los tres webhooks responden 200 con `SKIPPED` y `reason: "org_deleted_or_missing"` en vez de procesar.

- [ ] **Step 1: Write the failing tests**

`__tests__/lib/account-deletion/org-state.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { createChainMock, mockSupabaseFrom } from "../../api/helpers"
import { organizationAcceptsBilling } from "@/lib/account-deletion/org-state"

describe("organizationAcceptsBilling", () => {
  it("true para una org viva", async () => {
    mockSupabaseFrom({ organizations: createChainMock({ id: "o1", deleted_at: null }, null) })
    expect(await organizationAcceptsBilling("o1")).toBe(true)
  })
  it("false si está archivada o en gracia (deleted_at)", async () => {
    mockSupabaseFrom({ organizations: createChainMock({ id: "o1", deleted_at: "2026-10-05" }, null) })
    expect(await organizationAcceptsBilling("o1")).toBe(false)
  })
  it("false si ya no existe (purgada)", async () => {
    mockSupabaseFrom({ organizations: createChainMock(null, null) })
    expect(await organizationAcceptsBilling("o1")).toBe(false)
  })
  it("tira si la lectura falla, para que el proveedor reintente", async () => {
    mockSupabaseFrom({ organizations: createChainMock(null, { message: "down" }) })
    await expect(organizationAcceptsBilling("o1")).rejects.toThrow(/down/)
  })
})
```

`__tests__/api/creem-webhook-org-borrada.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/creem", () => ({ verifyCreemSignature: vi.fn(() => true) }))
vi.mock("@/lib/webhook-log", () => ({
  beginWebhookEvent: vi.fn().mockResolvedValue(null),
  finishWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from "@/app/api/creem/webhook/route"

const evento = (eventType: string) =>
  new NextRequest("http://localhost/api/creem/webhook", {
    method: "POST",
    headers: { "creem-signature": "ok" },
    body: JSON.stringify({
      id: "evt1",
      eventType,
      object: { id: "sub1", metadata: { organization_id: "o1", plan_slug: "profesional" }, product: { id: "p1" } },
    }),
  })

describe("webhook de Creem con la organización dada de baja", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(["subscription.active", "subscription.paid", "checkout.completed"])(
    "%s: responde 200 SKIPPED y no toca subscriptions (antes: FK -> 500 -> reintento infinito)",
    async (tipo) => {
      const subscriptions = createChainMock(null, null)
      mockSupabaseFrom({
        organizations: createChainMock(null, null), // org purgada
        subscriptions,
        plans: createChainMock({ id: "plan1", slug: "profesional" }, null),
      })
      const { status, body } = await parseResponse(await POST(evento(tipo)))
      expect(status).toBe(200)
      expect(body.result.status).toBe("SKIPPED")
      expect(body.result.reason).toBe("org_deleted_or_missing")
      expect(subscriptions.upsert).not.toHaveBeenCalled()
    }
  )
})
```

En `__tests__/api/mercadopago-webhook-duplicado.test.ts` agregar un caso nuevo al final del `describe` (reusar `PAGO_APROBADO` y el `global.fetch` del `beforeEach`):

```ts
  it("una org en período de gracia (deleted_at) no registra el pago ni reactiva la suscripción", async () => {
    const subscriptions = createChainMock(null, null)
    mockSupabaseFrom({
      organizations: createChainMock({ id: "org-1", activo: true, deleted_at: "2026-10-05T00:00:00Z" }, null),
      subscriptions,
      subscription_payments: createChainMock(null, null),
    })
    const r = await handlePaymentNotification("174586824094")
    expect(r).toMatchObject({ status: "SKIPPED", reason: "org_not_found_or_inactive" })
    expect(subscriptions.upsert).not.toHaveBeenCalled()
  })
```

(La firma de `handlePaymentNotification` se confirma leyendo cómo lo llaman los otros tests del archivo; usar los mismos argumentos.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/account-deletion/org-state.test.ts __tests__/api/creem-webhook-org-borrada.test.ts __tests__/api/mercadopago-webhook-duplicado.test.ts`
Expected: FAIL (módulo inexistente; Creem hace upsert; MP procesa).

- [ ] **Step 3: Write minimal implementation**

`lib/account-deletion/org-state.ts`:

```ts
import { supabaseAdmin } from "@/lib/supabase"

/**
 * ¿Se puede procesar un cobro para esta organización? No si ya no existe
 * (purgada) ni si está dada de baja (período de gracia): un pago en vuelo no
 * debe resucitar la suscripción que se canceló al pedir la eliminación.
 * Si la lectura falla TIRA: el webhook responde 500 y el proveedor reintenta.
 */
export async function organizationAcceptsBilling(orgId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("id, deleted_at")
    .eq("id", orgId)
    .maybeSingle()
  if (error) throw new Error(`organizations: ${error.message}`)
  return !!data && !data.deleted_at
}
```

MercadoPago (`handlePaymentNotification`, ~línea 320): `.select("id, activo")` → `.select("id, activo, deleted_at")` y `if (orgError || !org || org.activo === false) {` → `if (orgError || !org || org.activo === false || org.deleted_at) {`.

MercadoPago (handler de preapproval, justo después de `if (!organizationId) return { status: "SKIPPED", reason: "missing_organization_id" }` que precede a `const statusMap`): agregar
```ts
  if (!(await organizationAcceptsBilling(organizationId))) {
    return { status: "SKIPPED", reason: "org_deleted_or_missing", organizationId }
  }
```
con `import { organizationAcceptsBilling } from "@/lib/account-deletion/org-state"` arriba.

Rebill (~línea 180): `.select("id, activo")` → `.select("id, activo, deleted_at")` y `if (!org || org.activo === false) {` → `if (!org || org.activo === false || org.deleted_at) {`.

Creem: importar `organizationAcceptsBilling` y, en `handleCheckoutCompleted`, `handleSubscriptionActivate` y `handleSubscriptionPaid`, justo después de `if (!organizationId) return { status: "SKIPPED", reason: "missing_organization_id" }`, agregar el mismo bloque:
```ts
  if (!(await organizationAcceptsBilling(organizationId))) {
    return { status: "SKIPPED", reason: "org_deleted_or_missing", organizationId }
  }
```
`handleSubscriptionEnded` no cambia: su `UPDATE ... eq("organization_id")` sobre una org purgada afecta 0 filas y no falla.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/account-deletion/org-state.test.ts __tests__/api/creem-webhook-org-borrada.test.ts __tests__/api/mercadopago-webhook-duplicado.test.ts` y `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit y cierre de PR1**

```bash
git add lib/account-deletion/org-state.ts app/api/mercadopago/webhook/route.ts app/api/rebill/webhook/route.ts app/api/creem/webhook/route.ts __tests__/lib/account-deletion/org-state.test.ts __tests__/api/creem-webhook-org-borrada.test.ts __tests__/api/mercadopago-webhook-duplicado.test.ts
git commit -m "fix(webhooks): ignorar cobros de organizaciones dadas de baja o purgadas"
```

**Cierre de PR1 (antes de abrir el PR):**
- [ ] `npx eslint lib/account-deletion lib/user-status-edge.ts lib/auth.ts middleware.ts app/api/cron/account-deletion-purge "app/api/superadmin/organizations/[id]" app/api/creem/webhook app/api/rebill/webhook app/api/mercadopago/webhook`
- [ ] `npx tsc --noEmit` y `npx vitest run __tests__/lib/account-deletion __tests__/api/cron-account-deletion-purge.test.ts __tests__/api/superadmin-organizations.test.ts __tests__/api/creem-webhook-org-borrada.test.ts __tests__/account-deletion-migration.test.ts lib/__tests__`
- [ ] Aplicar la migración ANTES del merge: `node scripts/db-run.mjs supabase/migrations/338_eliminacion_de_cuenta.sql` (dry-run), revisar, luego `--apply`; correr `supabase/migrations/verify/338_probes.sql` en el SQL editor y el procedimiento de dos sesiones del encabezado del probe.
- [ ] Descripción del PR: el cron queda en dry-run; mencionar que esta rama cambia `authorize()` (usuarios/talleres dados de baja) y los webhooks.


---

# PR 2: API

### Task 10: Tipos compartidos y reautenticación

**Files:**
- Create: `lib/account-deletion/types.ts`
- Create: `lib/account-deletion/reauth.ts`
- Test: `__tests__/lib/account-deletion/reauth.test.ts`

**Interfaces:**
- Consumes: `verifyUserTotpCode(userId, code): Promise<{ valid: boolean }>` (`lib/totp`); RPC `handle_failed_login({ p_email })` (la misma que usa `authorize()` para el lockout); `bcryptjs`.
- Produces:
  - `types.ts` (sin imports de servidor, lo consume la UI): `ReauthInput = { password?: string; email?: string; totpCode?: string }`; `DeletionInfo = { role: "ADMIN" | "TECNICO" | "VENDEDOR"; slug: string; orgName: string; isLastAdmin: boolean; hasPassword: boolean; totpEnabled: boolean; graceDays: number }`.
  - `reauth.ts`: `ReauthResult = { ok: true } | { ok: false; status: 401; code: "WRONG_CREDENTIAL" | "REQUIRES_2FA" | "INVALID_2FA"; error: string }`; `verifyReauth(userId: string, input: ReauthInput): Promise<ReauthResult>`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import bcrypt from "bcryptjs"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock, mockSupabaseFrom } from "../../api/helpers"

vi.mock("@/lib/totp", () => ({ verifyUserTotpCode: vi.fn() }))
import { verifyUserTotpCode } from "@/lib/totp"
import { verifyReauth } from "@/lib/account-deletion/reauth"

const HASH = bcrypt.hashSync("secreto123", 4)
const user = (over: Record<string, unknown> = {}) =>
  createChainMock({ email: "Juan@Gmail.com", password: HASH, totp_enabled: false, ...over }, null)

describe("verifyReauth", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: null } as never)
  })

  it("acepta la contraseña correcta", async () => {
    mockSupabaseFrom({ users: user() })
    expect(await verifyReauth("u1", { password: "secreto123" })).toEqual({ ok: true })
  })

  it("rechaza contraseña incorrecta o vacía y suma un intento fallido (lockout)", async () => {
    mockSupabaseFrom({ users: user() })
    expect(await verifyReauth("u1", { password: "mala" })).toMatchObject({ ok: false, status: 401, code: "WRONG_CREDENTIAL" })
    expect(await verifyReauth("u1", { password: "" })).toMatchObject({ ok: false, code: "WRONG_CREDENTIAL" })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("handle_failed_login", { p_email: "Juan@Gmail.com" })
  })

  it("usuario Google (sin password): alcanza con tipear su email, sin distinguir mayúsculas", async () => {
    mockSupabaseFrom({ users: user({ password: null }) })
    expect(await verifyReauth("u1", { email: " juan@gmail.com " })).toEqual({ ok: true })
    expect(await verifyReauth("u1", { email: "otro@gmail.com" })).toMatchObject({ ok: false, code: "WRONG_CREDENTIAL" })
  })

  it("con 2FA activo exige el código", async () => {
    mockSupabaseFrom({ users: user({ totp_enabled: true }) })
    expect(await verifyReauth("u1", { password: "secreto123" })).toMatchObject({ ok: false, code: "REQUIRES_2FA" })
  })

  it("con 2FA activo valida el código", async () => {
    mockSupabaseFrom({ users: user({ totp_enabled: true }) })
    vi.mocked(verifyUserTotpCode).mockResolvedValueOnce({ valid: false })
    expect(await verifyReauth("u1", { password: "secreto123", totpCode: "000000" })).toMatchObject({ ok: false, code: "INVALID_2FA" })
    vi.mocked(verifyUserTotpCode).mockResolvedValueOnce({ valid: true })
    expect(await verifyReauth("u1", { password: "secreto123", totpCode: "123456" })).toEqual({ ok: true })
    expect(verifyUserTotpCode).toHaveBeenLastCalledWith("u1", "123456")
  })

  it("no valida el TOTP si la contraseña ya falló (no gasta códigos de respaldo)", async () => {
    mockSupabaseFrom({ users: user({ totp_enabled: true }) })
    await verifyReauth("u1", { password: "mala", totpCode: "123456" })
    expect(verifyUserTotpCode).not.toHaveBeenCalled()
  })

  it("usuario inexistente: falla genérico", async () => {
    mockSupabaseFrom({ users: createChainMock(null, { message: "no rows" }) })
    expect(await verifyReauth("u1", { password: "x" })).toMatchObject({ ok: false, code: "WRONG_CREDENTIAL" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/account-deletion/reauth.test.ts`
Expected: FAIL con "Failed to resolve import @/lib/account-deletion/reauth".

- [ ] **Step 3: Write minimal implementation**

`lib/account-deletion/types.ts`:

```ts
// Tipos compartidos entre las rutas /api/account/* y la UI. Sin imports de servidor.

export interface ReauthInput {
  /** Usuarios `credentials`. */
  password?: string
  /** Usuarios `google` (sin password): tipean su email. */
  email?: string
  /** Solo si el usuario tiene 2FA activo. */
  totpCode?: string
}

export interface DeletionInfo {
  role: "ADMIN" | "TECNICO" | "VENDEDOR"
  slug: string
  orgName: string
  /** ADMIN sin otro ADMIN activo en el taller: no puede borrar solo su usuario. */
  isLastAdmin: boolean
  hasPassword: boolean
  totpEnabled: boolean
  graceDays: number
}
```

`lib/account-deletion/reauth.ts`:

```ts
import bcrypt from "bcryptjs"
import { supabaseAdmin } from "@/lib/supabase"
import { verifyUserTotpCode } from "@/lib/totp"
import type { ReauthInput } from "./types"

export type ReauthResult =
  | { ok: true }
  | { ok: false; status: 401; code: "WRONG_CREDENTIAL" | "REQUIRES_2FA" | "INVALID_2FA"; error: string }

const fail = (code: "WRONG_CREDENTIAL" | "REQUIRES_2FA" | "INVALID_2FA", error: string): ReauthResult => ({
  ok: false,
  status: 401,
  code,
  error,
})

/**
 * Reautenticación antes de una acción destructiva. Contraseña para usuarios
 * `credentials`; email tipeado para usuarios Google (no tienen contraseña);
 * y TOTP/código de respaldo si tienen 2FA. Un fallo suma un intento al
 * lockout de la cuenta, igual que en el login: sin eso, una sesión robada
 * podría adivinar la contraseña acá sin límite.
 */
export async function verifyReauth(userId: string, input: ReauthInput): Promise<ReauthResult> {
  const { data: user, error } = await supabaseAdmin
    .from("users")
    .select("email, password, totp_enabled")
    .eq("id", userId)
    .single()
  if (error || !user) return fail("WRONG_CREDENTIAL", "No pudimos verificar tu identidad")

  const penalize = () => {
    Promise.resolve(supabaseAdmin.rpc("handle_failed_login", { p_email: user.email })).catch(() => {})
  }

  let credentialOk: boolean
  if (user.password) {
    credentialOk = !!input.password && (await bcrypt.compare(input.password, user.password))
  } else {
    credentialOk = !!input.email && input.email.trim().toLowerCase() === String(user.email).toLowerCase()
  }
  if (!credentialOk) {
    penalize()
    return fail("WRONG_CREDENTIAL", user.password ? "Contraseña incorrecta" : "El email no coincide con tu cuenta")
  }

  if (user.totp_enabled) {
    if (!input.totpCode) return fail("REQUIRES_2FA", "Ingresá tu código de verificación")
    const totp = await verifyUserTotpCode(userId, input.totpCode)
    if (!totp.valid) {
      penalize()
      return fail("INVALID_2FA", "Código de verificación inválido")
    }
  }

  return { ok: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/account-deletion/reauth.test.ts` y `npx tsc --noEmit`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/account-deletion/types.ts lib/account-deletion/reauth.ts __tests__/lib/account-deletion/reauth.test.ts
git commit -m "feat(account-deletion): reautenticacion con password, email o 2FA"
```

---

### Task 11: Emails de aviso a los ADMIN

**Files:**
- Create: `lib/account-deletion/emails.ts`
- Test: `__tests__/lib/account-deletion/emails.test.ts`

**Interfaces:**
- Consumes: `sendPlatform(msg: { to, subject, html }): Promise<SendResult>` de `@/lib/email/index` (ojo: NO `@/lib/email`, que resuelve al archivo `lib/email.ts`); `CONTACT_EMAIL` (`lib/contact`); `DEFAULT_TIMEZONE` (`lib/timezone`); `GRACE_DAYS` (tarea 2).
- Produces:
  - `escapeHtml(s: string): string`
  - `buildUserDeletedEmail(p: { nombre: string; email: string; rol: string }): { subject: string; html: string }`
  - `buildOrgDeletedEmail(p: { orgNombre: string; solicitante: string; borradoDefinitivo: Date }): { subject: string; html: string }`
  - `notifyAdminsUserDeleted(p: { organizationId: string; userId: string; nombre: string; email: string; rol: string }): Promise<void>` (a los ADMIN activos salvo el propio usuario)
  - `notifyAdminsOrgDeleted(p: { organizationId: string; orgNombre: string; solicitante: string; borradoDefinitivo: Date }): Promise<void>` (a todos los ADMIN)
  - Ninguna de las dos tira nunca: el aviso es best-effort y no puede tumbar la baja.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom } from "../../api/helpers"

vi.mock("@/lib/email/index", () => ({ sendPlatform: vi.fn().mockResolvedValue({ id: "m1", proveedor: "envialosimple" }) }))
import { sendPlatform } from "@/lib/email/index"
import {
  escapeHtml, buildUserDeletedEmail, buildOrgDeletedEmail, notifyAdminsUserDeleted, notifyAdminsOrgDeleted,
} from "@/lib/account-deletion/emails"

describe("builders", () => {
  it("escapeHtml neutraliza markup", () => {
    expect(escapeHtml(`<b>"x" & 'y'</b>`)).toBe("&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;")
  })

  it("el aviso de baja de usuario escapa el nombre (viene de un campo libre)", () => {
    const { subject, html } = buildUserDeletedEmail({ nombre: "<script>x</script>", email: "a@b.com", rol: "TECNICO" })
    expect(subject).toMatch(/baja/i)
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("el aviso de baja del taller trae la fecha de borrado definitivo, el solicitante y el contacto de soporte", () => {
    const { html } = buildOrgDeletedEmail({
      orgNombre: "Taller Uno", solicitante: "dueno@taller.com", borradoDefinitivo: new Date("2026-11-04T12:00:00Z"),
    })
    expect(html).toMatch(/noviembre/)
    expect(html).toContain("2026")
    expect(html).toContain("dueno@taller.com")
    expect(html).toContain("soporte@stapp.com.ar")
  })
})

describe("notify*", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("avisa a cada ADMIN activo y no al propio usuario dado de baja", async () => {
    const users = createChainMock([{ email: "a@t.com" }, { email: "b@t.com" }], null)
    mockSupabaseFrom({ users })
    await notifyAdminsUserDeleted({ organizationId: "o1", userId: "u9", nombre: "Pepe", email: "pepe@t.com", rol: "ADMIN" })
    expect(users.neq).toHaveBeenCalledWith("id", "u9")
    expect(users.is).toHaveBeenCalledWith("deleted_at", null)
    expect(vi.mocked(sendPlatform).mock.calls.map((c) => c[0].to)).toEqual(["a@t.com", "b@t.com"])
  })

  it("el aviso del taller va a todos los ADMIN, incluido quien lo pidió", async () => {
    const users = createChainMock([{ email: "a@t.com" }], null)
    mockSupabaseFrom({ users })
    await notifyAdminsOrgDeleted({ organizationId: "o1", orgNombre: "T", solicitante: "a@t.com", borradoDefinitivo: new Date() })
    expect(users.neq).not.toHaveBeenCalled()
    expect(sendPlatform).toHaveBeenCalledTimes(1)
  })

  it("no tira si falla el envío ni si falla la consulta de ADMIN", async () => {
    mockSupabaseFrom({ users: createChainMock([{ email: "a@t.com" }], null) })
    vi.mocked(sendPlatform).mockRejectedValueOnce(new Error("smtp"))
    await expect(
      notifyAdminsUserDeleted({ organizationId: "o1", userId: "u9", nombre: "P", email: "p@t.com", rol: "TECNICO" })
    ).resolves.toBeUndefined()

    mockSupabaseFrom({ users: createChainMock(null, { message: "down" }) })
    await expect(
      notifyAdminsOrgDeleted({ organizationId: "o1", orgNombre: "T", solicitante: "a", borradoDefinitivo: new Date() })
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/account-deletion/emails.test.ts`
Expected: FAIL con "Failed to resolve import @/lib/account-deletion/emails".

- [ ] **Step 3: Write minimal implementation**

```ts
import { supabaseAdmin } from "@/lib/supabase"
import { sendPlatform } from "@/lib/email/index"
import { CONTACT_EMAIL } from "@/lib/contact"
import { DEFAULT_TIMEZONE } from "@/lib/timezone"
import { GRACE_DAYS } from "./state"

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// getBaseTemplate (lib/email.ts) no está exportado: HTML mínimo propio.
function shell(titulo: string, cuerpo: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f3f4f6;">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
<h1 style="font-size:20px;color:#1f2937;margin:0 0 16px;">${escapeHtml(titulo)}</h1>
${cuerpo}
<p style="color:#9ca3af;font-size:12px;margin:24px 0 0;">Este correo fue enviado automáticamente por STApp.</p>
</div></body></html>`
}

const p = (s: string) => `<p style="color:#4b5563;font-size:15px;line-height:1.5;margin:0 0 12px;">${s}</p>`

function formatDate(d: Date): string {
  return d.toLocaleDateString("es-AR", { timeZone: DEFAULT_TIMEZONE, day: "numeric", month: "long", year: "numeric" })
}

export function buildUserDeletedEmail(x: { nombre: string; email: string; rol: string }) {
  const nombre = escapeHtml(x.nombre)
  return {
    subject: `Un usuario de tu taller se dio de baja: ${x.nombre}`,
    html: shell(
      "Un usuario se dio de baja",
      p(`<strong>${nombre}</strong> (${escapeHtml(x.email)}, rol ${escapeHtml(x.rol)}) eliminó su cuenta de STApp.`) +
        p(`Sus operaciones registradas se conservan y quedan firmadas como "Usuario eliminado". Sus datos personales se anonimizan a los ${GRACE_DAYS} días.`) +
        p(`Si fue un error, escribí a ${escapeHtml(CONTACT_EMAIL)} antes de ese plazo.`)
    ),
  }
}

export function buildOrgDeletedEmail(x: { orgNombre: string; solicitante: string; borradoDefinitivo: Date }) {
  return {
    subject: `Se pidió eliminar el taller ${x.orgNombre}`,
    html: shell(
      "Eliminación de taller solicitada",
      p(`<strong>${escapeHtml(x.solicitante)}</strong> pidió eliminar el taller <strong>${escapeHtml(x.orgNombre)}</strong>.`) +
        p(`El acceso se desactivó y la suscripción se canceló. Vas a poder revertirlo hasta el <strong>${escapeHtml(formatDate(x.borradoDefinitivo))}</strong>: después de esa fecha todos los datos se borran de forma definitiva, sin posibilidad de recuperarlos.`) +
        p(`Para revertirlo escribí a ${escapeHtml(CONTACT_EMAIL)}.`) +
        p("Conservar la documentación fiscal emitida es obligación del taller. Si todavía no descargaste tu respaldo, pedí la restauración para hacerlo.")
    ),
  }
}

async function adminEmails(organizationId: string, excludeUserId?: string): Promise<string[]> {
  let q = supabaseAdmin
    .from("users")
    .select("email")
    .eq("organization_id", organizationId)
    .eq("rol", "ADMIN")
    .is("deleted_at", null)
  if (excludeUserId) q = q.neq("id", excludeUserId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: { email: string }) => r.email).filter(Boolean)
}

async function sendAll(emails: string[], msg: { subject: string; html: string }) {
  await Promise.allSettled(emails.map((to) => sendPlatform({ to, subject: msg.subject, html: msg.html })))
}

export async function notifyAdminsUserDeleted(x: {
  organizationId: string
  userId: string
  nombre: string
  email: string
  rol: string
}): Promise<void> {
  try {
    await sendAll(await adminEmails(x.organizationId, x.userId), buildUserDeletedEmail(x))
  } catch (err) {
    console.error("[account-deletion] no se pudo avisar la baja del usuario:", err)
  }
}

export async function notifyAdminsOrgDeleted(x: {
  organizationId: string
  orgNombre: string
  solicitante: string
  borradoDefinitivo: Date
}): Promise<void> {
  try {
    await sendAll(await adminEmails(x.organizationId), buildOrgDeletedEmail(x))
  } catch (err) {
    console.error("[account-deletion] no se pudo avisar la baja del taller:", err)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/account-deletion/emails.test.ts` y `npx tsc --noEmit`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/account-deletion/emails.ts __tests__/lib/account-deletion/emails.test.ts
git commit -m "feat(account-deletion): avisos por email a los administradores del taller"
```

---

### Task 12: `POST /api/account/delete-user`

**Files:**
- Create: `app/api/account/delete-user/route.ts`
- Test: `__tests__/api/account-delete-user.test.ts`

**Interfaces:**
- Consumes: `requireAuth()` (devuelve `session`, `userId`, `organizationId`); `safeParseBody(request, schema)`; `verifyReauth` (tarea 10); `notifyAdminsUserDeleted` (tarea 11); RPC `solicitar_baja_usuario` (tarea 1).
- Produces: `POST /api/account/delete-user` con body `ReauthInput` → `200 { success: true }`; `401 { error, code }` reauth fallida; `403` sesión de impersonación o superadmin; `404` usuario inexistente; `409 { error, code: "LAST_ADMIN" }`; `500`. La respuesta 200 es idempotente (también para `ALREADY_DELETED`). El cliente cierra la sesión.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, mockAuthError, mockSupabaseFrom, createChainMock, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/account-deletion/reauth", () => ({ verifyReauth: vi.fn() }))
vi.mock("@/lib/account-deletion/emails", () => ({ notifyAdminsUserDeleted: vi.fn().mockResolvedValue(undefined) }))

import { verifyReauth } from "@/lib/account-deletion/reauth"
import { notifyAdminsUserDeleted } from "@/lib/account-deletion/emails"
import { POST } from "@/app/api/account/delete-user/route"

function setup(rpcData: string = "OK") {
  const push = createChainMock(null, null)
  const web = createChainMock(null, null)
  mockSupabaseFrom({
    users: createChainMock({ nombre: "Pepe", email: "pepe@t.com", rol: "TECNICO" }, null),
    push_tokens: push,
    web_push_subscriptions: web,
    audit_logs: createChainMock(null, null),
  })
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: rpcData, error: null } as never)
  return { push, web }
}

describe("POST /api/account/delete-user", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(verifyReauth).mockResolvedValue({ ok: true })
  })

  it.each(["ADMIN", "TECNICO", "VENDEDOR"])("un %s puede eliminar su propio usuario", async (role) => {
    mockAuthSuccess({ userId: "u1", organizationId: "o1", role })
    const { push, web } = setup("OK")
    const { status, body } = await parseResponse(await POST(createPostRequest({ password: "x" })))
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("solicitar_baja_usuario", { p_user_id: "u1" })
    expect(push.delete).toHaveBeenCalled()
    expect(web.delete).toHaveBeenCalled()
    expect(notifyAdminsUserDeleted).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "o1", userId: "u1" }))
  })

  it("sin sesión: 401", async () => {
    mockAuthError()
    expect((await POST(createPostRequest({}))).status).toBe(401)
  })

  it("reautenticación fallida: 401 con el code, y no se da de baja a nadie", async () => {
    mockAuthSuccess({ userId: "u1", role: "ADMIN" })
    setup()
    vi.mocked(verifyReauth).mockResolvedValueOnce({ ok: false, status: 401, code: "REQUIRES_2FA", error: "Ingresá tu código" })
    const { status, body } = await parseResponse(await POST(createPostRequest({ password: "x" })))
    expect(status).toBe(401)
    expect(body.code).toBe("REQUIRES_2FA")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("el último ADMIN recibe 409 LAST_ADMIN y no se tocan tokens ni se avisa a nadie", async () => {
    mockAuthSuccess({ userId: "u1", role: "ADMIN" })
    const { push } = setup("LAST_ADMIN")
    const { status, body } = await parseResponse(await POST(createPostRequest({ password: "x" })))
    expect(status).toBe(409)
    expect(body.code).toBe("LAST_ADMIN")
    expect(push.delete).not.toHaveBeenCalled()
    expect(notifyAdminsUserDeleted).not.toHaveBeenCalled()
  })

  it("el segundo de dos ADMIN simultáneos (la función ya vio al primero marcado) recibe 409", async () => {
    // La carrera real la serializa FOR UPDATE en SQL (probes de la 338). Acá se fija que
    // la ruta traduce LAST_ADMIN a 409 sin importar quién llega segundo.
    mockAuthSuccess({ userId: "u2", role: "ADMIN" })
    setup("LAST_ADMIN")
    expect((await POST(createPostRequest({ password: "x" }))).status).toBe(409)
  })

  it("una sesión de impersonación no puede eliminar al usuario del tenant", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", organizationId: "o1", role: "ADMIN", email: "t@t.com", isImpersonating: true },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as never)
    setup()
    expect((await POST(createPostRequest({ password: "x" }))).status).toBe(403)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("un superadmin no puede usar esta ruta", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", organizationId: "o1", role: "ADMIN", email: "sa@t.com", isSuperadmin: true },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as never)
    expect((await POST(createPostRequest({ password: "x" }))).status).toBe(403)
  })

  it("ALREADY_DELETED es idempotente: 200 sin repetir avisos", async () => {
    mockAuthSuccess({ userId: "u1", role: "TECNICO" })
    setup("ALREADY_DELETED")
    expect((await POST(createPostRequest({ password: "x" }))).status).toBe(200)
    expect(notifyAdminsUserDeleted).not.toHaveBeenCalled()
  })

  it("NOT_FOUND: 404; error del RPC: 500", async () => {
    mockAuthSuccess({ userId: "u1", role: "TECNICO" })
    setup("NOT_FOUND")
    expect((await POST(createPostRequest({ password: "x" }))).status).toBe(404)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "boom" } } as never)
    expect((await POST(createPostRequest({ password: "x" }))).status).toBe(500)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/account-delete-user.test.ts`
Expected: FAIL con "Failed to resolve import @/app/api/account/delete-user/route".

- [ ] **Step 3: Write minimal implementation**

```ts
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import { verifyReauth } from "@/lib/account-deletion/reauth"
import { notifyAdminsUserDeleted } from "@/lib/account-deletion/emails"

const bodySchema = z.object({
  password: z.string().max(200).optional(),
  email: z.string().max(200).optional(),
  totpCode: z.string().max(32).optional(),
})

// POST /api/account/delete-user — el usuario elimina SU PROPIO usuario.
// La fila no se borra (ventas, caja y órdenes la referencian): se marca
// deleted_at y a los 30 días el cron la anonimiza.
export async function POST(request: Request) {
  const { error, userId, organizationId, session } = await requireAuth()
  if (error) return error

  // El middleware ya bloquea escrituras en impersonación; esto es defensa en profundidad.
  if (session!.user.isImpersonating || session!.user.isSuperadmin) {
    return NextResponse.json({ error: "Acción no permitida en esta sesión" }, { status: 403 })
  }

  const parsed = await safeParseBody(request, bodySchema)
  if ("error" in parsed) return parsed.error

  const reauth = await verifyReauth(userId!, parsed.data)
  if (!reauth.ok) {
    return NextResponse.json({ error: reauth.error, code: reauth.code }, { status: reauth.status })
  }

  const { data: user } = await supabaseAdmin
    .from("users")
    .select("nombre, email, rol")
    .eq("id", userId!)
    .single()

  // Guarda del último ADMIN + deleted_at + activo=false + refresh_token=NULL en UNA transacción.
  const { data: estado, error: rpcError } = await supabaseAdmin.rpc("solicitar_baja_usuario", {
    p_user_id: userId!,
  })
  if (rpcError) {
    console.error("[account/delete-user] rpc:", rpcError)
    return NextResponse.json({ error: "No pudimos procesar la baja" }, { status: 500 })
  }

  if (estado === "NOT_FOUND") {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
  }
  if (estado === "LAST_ADMIN") {
    return NextResponse.json(
      {
        error: "Sos el último administrador del taller. Eliminá el taller o pasale el rol de administrador a otro usuario.",
        code: "LAST_ADMIN",
      },
      { status: 409 }
    )
  }
  if (estado === "ALREADY_DELETED") {
    return NextResponse.json({ success: true })
  }

  // Tokens de notificaciones: best-effort, la baja ya está hecha.
  await Promise.allSettled([
    supabaseAdmin.from("push_tokens").delete().eq("user_id", userId!),
    supabaseAdmin.from("web_push_subscriptions").delete().eq("user_id", userId!),
  ])

  try {
    await supabaseAdmin.from("audit_logs").insert({
      organization_id: organizationId,
      user_id: userId,
      action: "DELETE",
      entity: "users",
      entity_id: userId,
      changes: { self_service: true },
    })
  } catch {
    // best effort
  }

  await notifyAdminsUserDeleted({
    organizationId: organizationId!,
    userId: userId!,
    nombre: user?.nombre ?? "",
    email: user?.email ?? "",
    rol: user?.rol ?? "",
  })

  return NextResponse.json({ success: true })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/api/account-delete-user.test.ts` y `npx tsc --noEmit`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/account/delete-user/route.ts __tests__/api/account-delete-user.test.ts
git commit -m "feat(api): POST /api/account/delete-user con guarda del ultimo admin"
```

---

### Task 13: `POST /api/account/delete-organization`

**Files:**
- Create: `app/api/account/delete-organization/route.ts`
- Test: `__tests__/api/account-delete-organization.test.ts`

**Interfaces:**
- Consumes: `requireAdmin()`; `verifyReauth` (10); `cancelOrganizationSubscriptions` (2); `notifyAdminsOrgDeleted` (11); `DELETION_REASON`, `graceEndsAt` (2).
- Produces: `POST /api/account/delete-organization` con body `{ confirmSlug: string } & ReauthInput` → `200 { success: true, deletionDate: string }`; `400` subdominio no coincide; `401` reauth; `403` no ADMIN / impersonación / org del panel; `404`; `409` ya en proceso; `502 { error, providers }` si falla la cancelación (sin cambiar el estado de la org); `500`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/account-deletion/reauth", () => ({ verifyReauth: vi.fn() }))
vi.mock("@/lib/account-deletion/cancel-subscriptions", () => ({ cancelOrganizationSubscriptions: vi.fn() }))
vi.mock("@/lib/account-deletion/emails", () => ({ notifyAdminsOrgDeleted: vi.fn().mockResolvedValue(undefined) }))

import { verifyReauth } from "@/lib/account-deletion/reauth"
import { cancelOrganizationSubscriptions } from "@/lib/account-deletion/cancel-subscriptions"
import { notifyAdminsOrgDeleted } from "@/lib/account-deletion/emails"
import { POST } from "@/app/api/account/delete-organization/route"

function setup(org: Record<string, unknown> | null = { id: "o1", slug: "taller-uno", nombre: "Taller Uno", deleted_at: null }) {
  const orgChain = {
    ...createChainMock(org, null),
    update: vi.fn().mockReturnValue(createChainMock([{ id: "o1" }], null)),
  }
  const subs = createChainMock(null, null)
  mockSupabaseFrom({ organizations: orgChain as never, subscriptions: subs, audit_logs: createChainMock(null, null) })
  return { orgChain, subs }
}

const body = (over: Record<string, unknown> = {}) => createPostRequest({ confirmSlug: "taller-uno", password: "x", ...over })

describe("POST /api/account/delete-organization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
    mockAuthSuccess({ userId: "u1", organizationId: "o1", role: "ADMIN" })
    vi.mocked(verifyReauth).mockResolvedValue({ ok: true })
    vi.mocked(cancelOrganizationSubscriptions).mockResolvedValue({ ok: true, canceled: ["MERCADOPAGO"], skipped: false })
  })

  it.each(["TECNICO", "VENDEDOR"])("un %s recibe 403", async (role) => {
    mockAuthSuccess({ userId: "u1", organizationId: "o1", role })
    setup()
    expect((await POST(body())).status).toBe(403)
  })

  it("caso feliz: marca el taller, cancela, setea canceled_at, avisa y devuelve la fecha de borrado", async () => {
    const { orgChain, subs } = setup()
    const { status, body: b } = await parseResponse(await POST(body()))
    expect(status).toBe(200)
    expect(b.success).toBe(true)
    expect(new Date(b.deletionDate).getTime()).toBeGreaterThan(Date.now() + 29 * 86400000)

    const payload = orgChain.update.mock.calls[0][0]
    expect(payload).toMatchObject({
      deleted_by: "test@test.com",
      archived_reason: "user_requested_deletion",
    })
    expect(payload.deleted_at).toBeTruthy()
    expect(payload.deletion_requested_at).toBe(payload.deleted_at)
    expect(subs.update).toHaveBeenCalledWith({ canceled_at: payload.deleted_at })
    expect(notifyAdminsOrgDeleted).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "o1", orgNombre: "Taller Uno" }))
  })

  it("si falla la cancelación responde 502 con el mensaje del spec y NO cambia el estado de la org", async () => {
    const { orgChain, subs } = setup()
    vi.mocked(cancelOrganizationSubscriptions).mockResolvedValueOnce({ ok: false, failed: ["REBILL"], canceled: ["MERCADOPAGO"] })
    const { status, body: b } = await parseResponse(await POST(body()))
    expect(status).toBe(502)
    expect(b.error).toBe("No pudimos cancelar tu suscripción, reintentá o escribí a soporte")
    expect(b.providers).toEqual(["REBILL"])
    expect(orgChain.update).not.toHaveBeenCalled()
    expect(subs.update).not.toHaveBeenCalled()
    expect(notifyAdminsOrgDeleted).not.toHaveBeenCalled()
  })

  it("el subdominio tipeado tiene que coincidir (sin distinguir mayúsculas ni espacios)", async () => {
    const { orgChain } = setup()
    expect((await POST(body({ confirmSlug: "otro-taller" }))).status).toBe(400)
    expect(orgChain.update).not.toHaveBeenCalled()
    expect((await POST(body({ confirmSlug: "  Taller-Uno " }))).status).toBe(200)
  })

  it("reautenticación fallida: 401 y no se cancela nada", async () => {
    setup()
    vi.mocked(verifyReauth).mockResolvedValueOnce({ ok: false, status: 401, code: "WRONG_CREDENTIAL", error: "Contraseña incorrecta" })
    expect((await POST(body())).status).toBe(401)
    expect(cancelOrganizationSubscriptions).not.toHaveBeenCalled()
  })

  it("taller ya en proceso de eliminación: 409; org del panel: 403", async () => {
    setup({ id: "o1", slug: "taller-uno", nombre: "T", deleted_at: "2026-10-01" })
    expect((await POST(body())).status).toBe(409)
    setup({ id: "o1", slug: "superadmin", nombre: "Admin", deleted_at: null })
    expect((await POST(body({ confirmSlug: "superadmin" }))).status).toBe(403)
  })

  it("si otra request lo archivó entre el chequeo y el UPDATE: 409", async () => {
    const { orgChain } = setup()
    orgChain.update.mockReturnValueOnce(createChainMock([], null))
    expect((await POST(body())).status).toBe(409)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/account-delete-organization.test.ts`
Expected: FAIL con "Failed to resolve import @/app/api/account/delete-organization/route".

- [ ] **Step 3: Write minimal implementation**

```ts
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import { verifyReauth } from "@/lib/account-deletion/reauth"
import { cancelOrganizationSubscriptions } from "@/lib/account-deletion/cancel-subscriptions"
import { notifyAdminsOrgDeleted } from "@/lib/account-deletion/emails"
import { DELETION_REASON, graceEndsAt } from "@/lib/account-deletion/state"

const bodySchema = z.object({
  confirmSlug: z.string().min(1).max(100),
  password: z.string().max(200).optional(),
  email: z.string().max(200).optional(),
  totpCode: z.string().max(32).optional(),
})

// POST /api/account/delete-organization — un ADMIN pide eliminar el taller.
// Desactiva el acceso y cancela el cobro YA; el borrado definitivo lo hace el
// cron a los 30 días (hasta entonces soporte puede revertirlo).
export async function POST(request: Request) {
  const { error, userId, organizationId, session } = await requireAdmin()
  if (error) return error

  if (session!.user.isImpersonating || session!.user.isSuperadmin) {
    return NextResponse.json({ error: "Acción no permitida en esta sesión" }, { status: 403 })
  }

  const parsed = await safeParseBody(request, bodySchema)
  if ("error" in parsed) return parsed.error
  const { confirmSlug, ...reauthInput } = parsed.data

  const { data: org, error: orgError } = await supabaseAdmin
    .from("organizations")
    .select("id, slug, nombre, deleted_at")
    .eq("id", organizationId!)
    .single()
  if (orgError || !org) return NextResponse.json({ error: "Taller no encontrado" }, { status: 404 })
  if (org.slug === "superadmin") {
    return NextResponse.json({ error: "No se puede eliminar la organización del panel admin" }, { status: 403 })
  }
  if (org.deleted_at) {
    return NextResponse.json({ error: "El taller ya está en proceso de eliminación" }, { status: 409 })
  }
  if (confirmSlug.trim().toLowerCase() !== org.slug) {
    return NextResponse.json({ error: "El subdominio no coincide" }, { status: 400 })
  }

  const reauth = await verifyReauth(userId!, reauthInput)
  if (!reauth.ok) {
    return NextResponse.json({ error: reauth.error, code: reauth.code }, { status: reauth.status })
  }

  // 1) Cancelar el cobro. Si falla cualquier proveedor: 502 y NADA cambia, para
  //    no dejar un taller desactivado que siga cobrándose.
  const cancel = await cancelOrganizationSubscriptions(org.id)
  if (!cancel.ok) {
    return NextResponse.json(
      { error: "No pudimos cancelar tu suscripción, reintentá o escribí a soporte", providers: cancel.failed },
      { status: 502 }
    )
  }

  const now = new Date()
  const nowIso = now.toISOString()

  // 2) canceled_at ANTES de archivar: si el paso siguiente falla, el reintento
  //    ve la suscripción cancelada y no vuelve a llamar a los proveedores.
  try {
    await supabaseAdmin.from("subscriptions").update({ canceled_at: nowIso }).eq("organization_id", org.id)
  } catch (err) {
    console.error("[account/delete-organization] canceled_at:", err)
  }

  // 3) Archivar: el middleware corta el acceso en <=30 s. El .is("deleted_at", null)
  //    evita pisar a otra request concurrente (TOCTOU).
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("organizations")
    .update({
      deleted_at: nowIso,
      deleted_by: session!.user.email ?? null,
      archived_reason: DELETION_REASON,
      deletion_requested_at: nowIso,
    })
    .eq("id", org.id)
    .is("deleted_at", null)
    .select("id")
  if (updateError) {
    console.error("[account/delete-organization] update:", updateError)
    return NextResponse.json({ error: "No pudimos procesar la baja del taller" }, { status: 500 })
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: "El taller ya está en proceso de eliminación" }, { status: 409 })
  }

  const borradoDefinitivo = graceEndsAt(now)

  try {
    await supabaseAdmin.from("audit_logs").insert({
      organization_id: org.id,
      user_id: userId,
      action: "ARCHIVE",
      entity: "organizations",
      entity_id: org.id,
      changes: { reason: DELETION_REASON, requested_by: session!.user.email ?? null },
    })
  } catch {
    // best effort
  }

  await notifyAdminsOrgDeleted({
    organizationId: org.id,
    orgNombre: org.nombre,
    solicitante: session!.user.email ?? "",
    borradoDefinitivo,
  })

  return NextResponse.json({ success: true, deletionDate: borradoDefinitivo.toISOString() })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/api/account-delete-organization.test.ts` y `npx tsc --noEmit`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/account/delete-organization/route.ts __tests__/api/account-delete-organization.test.ts
git commit -m "feat(api): POST /api/account/delete-organization con cancelacion previa y 502 sin cambios"
```

---

### Task 14: `GET /api/account/deletion-info`

**Files:**
- Create: `app/api/account/deletion-info/route.ts`
- Test: `__tests__/api/account-deletion-info.test.ts`

**Interfaces:**
- Consumes: `requireAuth()`; `DeletionInfo` (tarea 10); `GRACE_DAYS` (tarea 2).
- Produces: `GET /api/account/deletion-info` → `DeletionInfo` (con `Cache-Control: no-store`).

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockAuthError, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { GET } from "@/app/api/account/deletion-info/route"

function setup(otrosAdmins: number) {
  mockSupabaseFrom({
    users: createChainMock({ password: "hash", totp_enabled: true }, null, otrosAdmins),
    organizations: createChainMock({ slug: "taller-uno", nombre: "Taller Uno" }, null),
  })
}

describe("GET /api/account/deletion-info", () => {
  beforeEach(() => vi.clearAllMocks())

  it("sin sesión: 401", async () => {
    mockAuthError()
    expect((await GET()).status).toBe(401)
  })

  it("ADMIN sin otros ADMIN activos es el último", async () => {
    mockAuthSuccess({ userId: "u1", organizationId: "o1", role: "ADMIN" })
    setup(0)
    const { status, body } = await parseResponse(await GET())
    expect(status).toBe(200)
    expect(body).toEqual({
      role: "ADMIN", slug: "taller-uno", orgName: "Taller Uno",
      isLastAdmin: true, hasPassword: true, totpEnabled: true, graceDays: 30,
    })
  })

  it("ADMIN con otro ADMIN no es el último", async () => {
    mockAuthSuccess({ userId: "u1", organizationId: "o1", role: "ADMIN" })
    setup(1)
    expect((await parseResponse(await GET())).body.isLastAdmin).toBe(false)
  })

  it("un TECNICO nunca es 'último ADMIN' y no paga la consulta", async () => {
    mockAuthSuccess({ userId: "u1", organizationId: "o1", role: "TECNICO" })
    setup(0)
    expect((await parseResponse(await GET())).body.isLastAdmin).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/account-deletion-info.test.ts`
Expected: FAIL con "Failed to resolve import @/app/api/account/deletion-info/route".

- [ ] **Step 3: Write minimal implementation**

```ts
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { GRACE_DAYS } from "@/lib/account-deletion/state"
import type { DeletionInfo } from "@/lib/account-deletion/types"

// GET /api/account/deletion-info — lo que la Zona de peligro necesita saber.
// /api/users/profile no trae el slug ni si el usuario es el último ADMIN.
export async function GET() {
  const { error, userId, organizationId, role } = await requireAuth()
  if (error) return error

  const [{ data: user }, { data: org }, otros] = await Promise.all([
    supabaseAdmin.from("users").select("password, totp_enabled").eq("id", userId!).single(),
    supabaseAdmin.from("organizations").select("slug, nombre").eq("id", organizationId!).single(),
    role === "ADMIN"
      ? supabaseAdmin
          .from("users")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId!)
          .eq("rol", "ADMIN")
          .is("deleted_at", null)
          .neq("id", userId!)
      : Promise.resolve(null),
  ])

  if (!user || !org) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })

  const info: DeletionInfo = {
    role: role as DeletionInfo["role"],
    slug: org.slug,
    orgName: org.nombre,
    isLastAdmin: role === "ADMIN" && (otros?.count ?? 0) === 0,
    hasPassword: !!user.password,
    totpEnabled: !!user.totp_enabled,
    graceDays: GRACE_DAYS,
  }
  return NextResponse.json(info, { headers: { "Cache-Control": "no-store" } })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/api/account-deletion-info.test.ts` y `npx tsc --noEmit`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/account/deletion-info/route.ts __tests__/api/account-deletion-info.test.ts
git commit -m "feat(api): GET /api/account/deletion-info para la zona de peligro"
```


---

### Task 15: CSV seguro para respaldo y ZIP en streaming (`fflate`)

**Files:**
- Modify: `package.json`, `package-lock.json` (agrega `fflate`)
- Create: `lib/account-deletion/export-csv.ts`
- Create: `lib/account-deletion/zip.ts`
- Test: `__tests__/lib/account-deletion/export-csv.test.ts`, `__tests__/lib/account-deletion/zip.test.ts`

**Interfaces:**
- Produces:
  - `rowsToCsv(rows: Array<Record<string, unknown>>): string` — UTF-8 con BOM, CRLF, columnas = unión de claves en orden de aparición, números tal cual (los negativos NO se tocan), strings que empiezan con `= + - @ TAB CR` se prefijan con `'`, objetos/arrays como JSON, `null/undefined` vacíos. Sin filas devuelve solo el BOM.
  - `interface ZipWriter { addText(name: string, text: string): void; addBytes(name: string, data: Uint8Array, opts?: { store?: boolean }): void }`
  - `buildZipStream(fill: (zip: ZipWriter) => Promise<void>): ReadableStream<Uint8Array>` — los chunks salen a medida que se agregan archivos; si `fill` tira, el stream falla (descarga truncada, que el navegador marca como error).

**Por qué `fflate` (y un CSV propio):** no hay librería ZIP en `package.json`. `fflate` no tiene dependencias, expone `Zip` por chunks (no arma todo el archivo en memoria como `jszip`) y no depende de streams de Node como `archiver`. `arrayToCSV` de `lib/csv-export.ts` se descarta porque prefija con `'` también los números negativos (`-5` → `'-5`), que en un respaldo fiscal son notas de crédito y devoluciones.

- [ ] **Step 1: Instalar la dependencia (en un worktree con `node_modules` sano)**

Run: `npm install fflate@^0.8.2`
Expected: `package.json` suma `"fflate"` en `dependencies` y cambia `package-lock.json`. (El `node_modules` del clon principal está roto; usar un worktree con dependencias instaladas o correr `npm ci` primero.)

- [ ] **Step 2: Write the failing tests**

`__tests__/lib/account-deletion/export-csv.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { rowsToCsv } from "@/lib/account-deletion/export-csv"

const sinBom = (s: string) => s.replace(/^﻿/, "")

describe("rowsToCsv", () => {
  it("empieza con BOM (Excel abre UTF-8) y usa CRLF", () => {
    const csv = rowsToCsv([{ a: 1 }])
    expect(csv.startsWith("﻿")).toBe(true)
    expect(sinBom(csv)).toBe("a\r\n1\r\n")
  })

  it("conserva los importes negativos (notas de crédito y devoluciones)", () => {
    expect(sinBom(rowsToCsv([{ monto: -1500.5 }, { monto: 20 }]))).toBe("monto\r\n-1500.5\r\n20\r\n")
  })

  it("neutraliza fórmulas SOLO en strings", () => {
    const csv = sinBom(rowsToCsv([{ nombre: "=HYPERLINK(\"x\")" }, { nombre: "+5491155" }, { nombre: "@cmd" }, { nombre: "-x" }]))
    expect(csv).toContain("\"'=HYPERLINK(\"\"x\"\")\"")
    expect(csv).toContain("'+5491155")
    expect(csv).toContain("'@cmd")
    expect(csv).toContain("'-x")
  })

  it("escapa comillas, comas y saltos de línea", () => {
    expect(sinBom(rowsToCsv([{ n: 'a,"b"\nc' }]))).toBe('n\r\n"a,""b""\nc"\r\n')
  })

  it("une las columnas de todas las filas y deja vacío lo que falta", () => {
    expect(sinBom(rowsToCsv([{ a: 1 }, { b: 2 }]))).toBe("a,b\r\n1,\r\n,2\r\n")
  })

  it("null/undefined vacíos, booleanos y objetos serializados", () => {
    expect(sinBom(rowsToCsv([{ a: null, b: undefined, c: true, d: { x: 1 } }]))).toBe('a,b,c,d\r\n,,true,"{""x"":1}"\r\n')
  })

  it("sin filas devuelve solo el BOM", () => {
    expect(rowsToCsv([])).toBe("﻿")
  })
})
```

`__tests__/lib/account-deletion/zip.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { unzipSync, strFromU8 } from "fflate"
import { buildZipStream } from "@/lib/account-deletion/zip"

async function read(stream: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

describe("buildZipStream", () => {
  it("produce un ZIP válido con texto y binarios", async () => {
    const pdf = new Uint8Array([37, 80, 68, 70, 1, 2, 3])
    const bytes = await read(
      buildZipStream(async (zip) => {
        zip.addText("clientes.csv", "id,nombre\r\n1,Ñandú\r\n")
        zip.addBytes("comprobantes_pdf/a.pdf", pdf, { store: true })
      })
    )
    const files = unzipSync(bytes)
    expect(Object.keys(files).sort()).toEqual(["clientes.csv", "comprobantes_pdf/a.pdf"])
    expect(strFromU8(files["clientes.csv"])).toBe("id,nombre\r\n1,Ñandú\r\n")
    expect(Array.from(files["comprobantes_pdf/a.pdf"])).toEqual(Array.from(pdf))
  })

  it("si fill tira, el stream falla (no entrega un ZIP 'completo' trunco)", async () => {
    const stream = buildZipStream(async (zip) => {
      zip.addText("a.txt", "x")
      throw new Error("boom")
    })
    await expect(read(stream)).rejects.toThrow("boom")
  })

  it("un ZIP sin archivos igual es válido", async () => {
    expect(Object.keys(unzipSync(await read(buildZipStream(async () => {}))))).toEqual([])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/account-deletion/export-csv.test.ts __tests__/lib/account-deletion/zip.test.ts`
Expected: FAIL con "Failed to resolve import".

- [ ] **Step 4: Write minimal implementation**

`lib/account-deletion/export-csv.ts`:

```ts
// CSV para el respaldo del taller. Propio y no `arrayToCSV` (lib/csv-export.ts):
// aquél prefija con `'` también los números negativos, y en un respaldo fiscal
// los negativos son notas de crédito y devoluciones.

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number" || typeof value === "bigint") return String(value)
  if (typeof value === "boolean") return value ? "true" : "false"

  let text = typeof value === "string" ? value : JSON.stringify(value)
  // Fórmulas: Excel/Sheets ejecutan celdas que empiezan con = + - @ TAB CR.
  // Solo se aplica a strings: un número negativo no es una fórmula.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = "'" + text
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function rowsToCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "﻿"

  const columns: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key)
        columns.push(key)
      }
    }
  }

  const lines = [columns.map(escapeCell).join(",")]
  for (const row of rows) lines.push(columns.map((c) => escapeCell(row[c])).join(","))
  return "﻿" + lines.join("\r\n") + "\r\n"
}
```

`lib/account-deletion/zip.ts`:

```ts
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from "fflate"

export interface ZipWriter {
  addText(name: string, text: string): void
  /** `store: true` para contenido ya comprimido (PDF): no gasta CPU en deflate. */
  addBytes(name: string, data: Uint8Array, opts?: { store?: boolean }): void
}

/**
 * ZIP que sale por chunks a medida que `fill` agrega archivos. No hay
 * backpressure (los chunks se encolan apenas se generan), así que la memoria
 * queda acotada por el tamaño total del ZIP: los topes de PDFs del export la
 * mantienen en ~100 MB más los CSV.
 */
export function buildZipStream(fill: (zip: ZipWriter) => Promise<void>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const zip = new Zip((err, chunk, final) => {
        if (err) {
          controller.error(err)
          return
        }
        controller.enqueue(chunk)
        if (final) controller.close()
      })

      const add = (name: string, data: Uint8Array, store: boolean) => {
        const file = store ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 })
        zip.add(file)
        file.push(data, true)
      }

      try {
        await fill({
          addText: (name, text) => add(name, strToU8(text), false),
          addBytes: (name, data, opts) => add(name, data, !!opts?.store),
        })
        zip.end()
      } catch (err) {
        controller.error(err)
      }
    },
  })
}
```

- [ ] **Step 5: Run tests to verify they pass, then commit**

Run: `npx vitest run __tests__/lib/account-deletion/export-csv.test.ts __tests__/lib/account-deletion/zip.test.ts` y `npx tsc --noEmit`
Expected: PASS (10 tests).

```bash
git add package.json package-lock.json lib/account-deletion/export-csv.ts lib/account-deletion/zip.ts __tests__/lib/account-deletion/export-csv.test.ts __tests__/lib/account-deletion/zip.test.ts
git commit -m "feat(account-deletion): csv seguro y zip en streaming para el respaldo"
```

---

### Task 16: Armado del respaldo del taller

**Files:**
- Create: `lib/account-deletion/export-organization.ts`
- Test: `__tests__/lib/account-deletion/export-organization.test.ts`

**Interfaces:**
- Consumes: `rowsToCsv` y `buildZipStream`/`ZipWriter` (tarea 15); tablas `clientes`, `ventas`, `items_venta`, `pagos_venta`, `facturas` (sin `organization_id`: se une por `ordenes_servicio`), `notas_credito`, `cuenta_corriente`, `comprobantes_fiscales`.
- Produces:
  - constantes `MAX_PDFS = 300`, `MAX_PDF_BYTES = 100 * 1024 * 1024`, `EXPORT_BUDGET_MS = 50_000`, `PDF_ALLOWED_HOST_SUFFIXES = ["tusfacturas.app"]`
  - `isAllowedPdfUrl(raw: string): boolean`
  - `fetchAllRows(table: string, select: string, apply: (q: any) => any): Promise<Array<Record<string, unknown>>>` (pagina de a 1000, ordena por `id`)
  - `collectPdfs(rows: PdfSource[], deadline: number, opts?: { fetchImpl?: typeof fetch; maxFiles?: number; maxBytes?: number }): Promise<{ files: Array<{ name: string; bytes: Uint8Array }>; pending: PendingPdf[] }>` con `PdfSource = { id: string; numero: string | null; pdf_url: string | null }` y `PendingPdf = { comprobante: string; url: string; motivo: string }`
  - `buildReadme(p: { orgNombre: string; slug: string; generadoEn: Date; pdfIncluidos: number; pendientes: number }): string`
  - `buildOrganizationExportStream(org: { id: string; nombre: string; slug: string }, opts?: { fetchImpl?: typeof fetch }): ReadableStream<Uint8Array>`

Contenido del ZIP: `clientes.csv`, `ventas.csv`, `ventas_items.csv`, `ventas_pagos.csv`, `facturas.csv`, `notas_credito.csv`, `cuenta_corriente.csv`, `comprobantes_fiscales.csv` (sin `provider_response`), `comprobantes_pdf/*.pdf`, `pdfs-pendientes.csv` (solo si hubo pendientes) y `LEEME.txt`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { unzipSync, strFromU8 } from "fflate"
import { createChainMock, mockSupabaseFrom } from "../../api/helpers"
import {
  isAllowedPdfUrl, fetchAllRows, collectPdfs, buildReadme, buildOrganizationExportStream,
} from "@/lib/account-deletion/export-organization"
import { supabaseAdmin } from "@/lib/supabase"

const pdfOk = () => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 })
const row = (n: number, url: string | null) => ({ id: `c${n}`, numero: `0001-${n}`, pdf_url: url })

describe("isAllowedPdfUrl", () => {
  it.each([
    ["https://www.tusfacturas.app/x.pdf", true],
    ["https://tusfacturas.app/x.pdf", true],
    ["http://www.tusfacturas.app/x.pdf", false],
    ["https://tusfacturas.app.evil.com/x.pdf", false],
    ["https://evil.com/tusfacturas.app", false],
    ["no es una url", false],
  ])("%s -> %s", (url, esperado) => expect(isAllowedPdfUrl(url)).toBe(esperado))
})

describe("collectPdfs", () => {
  const deadline = () => Date.now() + 60_000

  it("baja los permitidos, sin seguir redirects, y manda el resto a pendientes", async () => {
    const fetchImpl = vi.fn(async () => pdfOk()) as unknown as typeof fetch
    const r = await collectPdfs(
      [row(1, "https://www.tusfacturas.app/a.pdf"), row(2, "https://evil.com/b.pdf"), row(3, null)],
      deadline(),
      { fetchImpl }
    )
    expect(r.files).toHaveLength(1)
    expect(r.files[0].name).toBe("0001-1-c1.pdf")
    expect(r.pending).toEqual([{ comprobante: "0001-2", url: "https://evil.com/b.pdf", motivo: "host no permitido" }])
    expect(vi.mocked(fetchImpl).mock.calls[0][1]).toMatchObject({ redirect: "error" })
  })

  it("respeta el tope de archivos: lo que no entra queda en pendientes con su link", async () => {
    const fetchImpl = vi.fn(async () => pdfOk()) as unknown as typeof fetch
    const rows = [1, 2, 3].map((n) => row(n, `https://www.tusfacturas.app/${n}.pdf`))
    const r = await collectPdfs(rows, deadline(), { fetchImpl, maxFiles: 2 })
    expect(r.files).toHaveLength(2)
    expect(r.pending).toHaveLength(1)
    expect(r.pending[0].motivo).toMatch(/tope/)
    expect(r.pending[0].url).toBe("https://www.tusfacturas.app/3.pdf")
  })

  it("respeta el tope de bytes", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(600), { status: 200 })) as unknown as typeof fetch
    const rows = [1, 2].map((n) => row(n, `https://www.tusfacturas.app/${n}.pdf`))
    const r = await collectPdfs(rows, deadline(), { fetchImpl, maxBytes: 1000 })
    expect(r.files).toHaveLength(1)
    expect(r.pending[0].motivo).toMatch(/tope/)
  })

  it("pasado el deadline no baja más y lo informa", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const r = await collectPdfs([row(1, "https://www.tusfacturas.app/1.pdf")], Date.now() - 1, { fetchImpl })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(r.pending[0].motivo).toMatch(/tiempo/)
  })

  it("un HTTP 404 o un error de red no rompen el respaldo", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("x", { status: 404 }))
      .mockRejectedValueOnce(new Error("timeout")) as unknown as typeof fetch
    const rows = [1, 2].map((n) => row(n, `https://www.tusfacturas.app/${n}.pdf`))
    const r = await collectPdfs(rows, deadline(), { fetchImpl })
    expect(r.files).toHaveLength(0)
    expect(r.pending.map((p) => p.motivo)).toEqual(["HTTP 404", "no se pudo descargar"])
  })
})

describe("fetchAllRows", () => {
  it("pagina de a 1000 hasta agotar (2500 filas = 3 pedidos)", async () => {
    const all = Array.from({ length: 2500 }, (_, i) => ({ id: String(i) }))
    const range = vi.fn(async (from: number, to: number) => ({ data: all.slice(from, to + 1), error: null }))
    const chain: Record<string, unknown> = {}
    chain.select = vi.fn(() => chain)
    chain.order = vi.fn(() => chain)
    chain.range = range
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as never)
    expect(await fetchAllRows("clientes", "*", (q) => q)).toHaveLength(2500)
    expect(range).toHaveBeenCalledTimes(3)
  })

  it("un error de la BD tira con el nombre de la tabla", async () => {
    mockSupabaseFrom({ clientes: createChainMock(null, { message: "down" }) })
    await expect(fetchAllRows("clientes", "*", (q) => q)).rejects.toThrow(/clientes: down/)
  })
})

describe("buildReadme", () => {
  it("siempre avisa que la documentación fiscal es obligación del taller", () => {
    const t = buildReadme({ orgNombre: "Taller", slug: "taller", generadoEn: new Date("2026-10-05T12:00:00Z"), pdfIncluidos: 3, pendientes: 0 })
    expect(t).toMatch(/obligaci[oó]n del taller/i)
    expect(t).not.toMatch(/pdfs-pendientes/)
  })
  it("si hubo pendientes explica el tope y apunta a pdfs-pendientes.csv", () => {
    const t = buildReadme({ orgNombre: "Taller", slug: "taller", generadoEn: new Date(), pdfIncluidos: 300, pendientes: 12 })
    expect(t).toMatch(/pdfs-pendientes\.csv/)
    expect(t).toMatch(/12/)
  })
})

describe("buildOrganizationExportStream", () => {
  beforeEach(() => vi.clearAllMocks())

  it("arma el ZIP: CSVs, PDFs, sin provider_response y sin la unión interna de facturas", async () => {
    const comprobantes = createChainMock(
      [
        { id: "c1", numero: "0001-1", estado: "emitido", pdf_url: "https://www.tusfacturas.app/1.pdf", total: -50 },
        { id: "c2", numero: "0001-2", estado: "emitido", pdf_url: "https://otro.com/2.pdf", total: 10 },
      ],
      null
    )
    mockSupabaseFrom({
      clientes: createChainMock([{ id: "k1", nombre: "Ana" }], null),
      ventas: createChainMock([{ id: "v1", total: 100 }], null),
      items_venta: createChainMock([{ id: "i1", venta_id: "v1" }], null),
      pagos_venta: createChainMock([{ id: "p1", venta_id: "v1", monto: 100 }], null),
      facturas: createChainMock([{ id: "f1", numero_factura: "A-1", ordenes_servicio: { organization_id: "o1" } }], null),
      notas_credito: createChainMock([], null),
      cuenta_corriente: createChainMock([], null),
      comprobantes_fiscales: comprobantes,
    })
    const fetchImpl = vi.fn(async () => pdfOk()) as unknown as typeof fetch

    const bytes = new Uint8Array(await new Response(buildOrganizationExportStream({ id: "o1", nombre: "Taller", slug: "taller" }, { fetchImpl })).arrayBuffer())
    const files = unzipSync(bytes)

    expect(Object.keys(files).sort()).toEqual([
      "LEEME.txt",
      "clientes.csv",
      "comprobantes_fiscales.csv",
      "comprobantes_pdf/0001-1-c1.pdf",
      "cuenta_corriente.csv",
      "facturas.csv",
      "notas_credito.csv",
      "pdfs-pendientes.csv",
      "ventas.csv",
      "ventas_items.csv",
      "ventas_pagos.csv",
    ])
    expect(strFromU8(files["comprobantes_fiscales.csv"])).toContain("-50")
    expect(strFromU8(files["facturas.csv"])).not.toContain("ordenes_servicio")
    expect(strFromU8(files["pdfs-pendientes.csv"])).toContain("https://otro.com/2.pdf")
    expect(String(comprobantes.select.mock.calls[0][0])).not.toContain("provider_response")
    expect(strFromU8(files["LEEME.txt"])).toMatch(/obligaci[oó]n del taller/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/account-deletion/export-organization.test.ts`
Expected: FAIL con "Failed to resolve import @/lib/account-deletion/export-organization".

- [ ] **Step 3: Write minimal implementation**

```ts
import { supabaseAdmin } from "@/lib/supabase"
import { DEFAULT_TIMEZONE } from "@/lib/timezone"
import { rowsToCsv } from "./export-csv"
import { buildZipStream } from "./zip"

// Topes del spec. Son constantes del módulo: se ajustan si las pruebas reales
// muestran que entran más dentro de los 60 s.
export const MAX_PDFS = 300
export const MAX_PDF_BYTES = 100 * 1024 * 1024
export const EXPORT_BUDGET_MS = 50_000

// pdf_url es un link del proveedor de facturación (TusFacturas), no un archivo
// nuestro. Solo se descargan hosts conocidos; el resto va a pdfs-pendientes.csv.
export const PDF_ALLOWED_HOST_SUFFIXES = ["tusfacturas.app"]

const PDF_FETCH_TIMEOUT_MS = 10_000
const PDF_CONCURRENCY = 5
const PAGE = 1000
const IN_CHUNK = 200

type Row = Record<string, unknown>
export interface PdfSource { id: string; numero: string | null; pdf_url: string | null }
export interface PendingPdf { comprobante: string; url: string; motivo: string }

export function isAllowedPdfUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return (
      u.protocol === "https:" &&
      PDF_ALLOWED_HOST_SUFFIXES.some((s) => u.hostname === s || u.hostname.endsWith(`.${s}`))
    )
  } catch {
    return false
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAllRows(table: string, select: string, apply: (q: any) => any): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await apply(supabaseAdmin.from(table).select(select))
      .order("id")
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...((data ?? []) as Row[]))
    if (!data || data.length < PAGE) break
  }
  return rows
}

async function downloadPdf(url: string, fetchImpl: typeof fetch): Promise<{ bytes: Uint8Array } | { error: string }> {
  if (!isAllowedPdfUrl(url)) return { error: "host no permitido" }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PDF_FETCH_TIMEOUT_MS)
  try {
    // redirect: "error" — un 30x hacia otro host saltearía la allowlist.
    const res = await fetchImpl(url, { signal: ctrl.signal, redirect: "error" })
    if (!res.ok) return { error: `HTTP ${res.status}` }
    return { bytes: new Uint8Array(await res.arrayBuffer()) }
  } catch {
    return { error: "no se pudo descargar" }
  } finally {
    clearTimeout(timer)
  }
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_")

export async function collectPdfs(
  rows: PdfSource[],
  deadline: number,
  opts: { fetchImpl?: typeof fetch; maxFiles?: number; maxBytes?: number } = {}
): Promise<{ files: Array<{ name: string; bytes: Uint8Array }>; pending: PendingPdf[] }> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const maxFiles = opts.maxFiles ?? MAX_PDFS
  const maxBytes = opts.maxBytes ?? MAX_PDF_BYTES
  const files: Array<{ name: string; bytes: Uint8Array }> = []
  const pending: PendingPdf[] = []
  let total = 0

  const queue = rows.filter((r) => r.pdf_url)
  const label = (r: PdfSource) => r.numero ?? r.id

  for (let i = 0; i < queue.length; i += PDF_CONCURRENCY) {
    const batch = queue.slice(i, i + PDF_CONCURRENCY)

    if (Date.now() > deadline) {
      for (const r of queue.slice(i)) pending.push({ comprobante: label(r), url: r.pdf_url as string, motivo: "se acabó el tiempo" })
      break
    }

    const results = await Promise.all(batch.map((r) => downloadPdf(r.pdf_url as string, fetchImpl)))
    batch.forEach((r, idx) => {
      const res = results[idx]
      const url = r.pdf_url as string
      if ("error" in res) {
        pending.push({ comprobante: label(r), url, motivo: res.error })
      } else if (files.length >= maxFiles || total + res.bytes.length > maxBytes) {
        pending.push({ comprobante: label(r), url, motivo: "tope de archivos o tamaño" })
      } else {
        total += res.bytes.length
        files.push({ name: `${safeName(label(r))}-${safeName(r.id)}.pdf`, bytes: res.bytes })
      }
    })
  }
  return { files, pending }
}

export function buildReadme(p: {
  orgNombre: string
  slug: string
  generadoEn: Date
  pdfIncluidos: number
  pendientes: number
}): string {
  const fecha = p.generadoEn.toLocaleString("es-AR", { timeZone: DEFAULT_TIMEZONE })
  const lines = [
    `Respaldo de ${p.orgNombre} (${p.slug})`,
    `Generado: ${fecha}`,
    "",
    "Contenido:",
    "- clientes.csv, ventas.csv, ventas_items.csv, ventas_pagos.csv",
    "- facturas.csv, notas_credito.csv, cuenta_corriente.csv",
    "- comprobantes_fiscales.csv (comprobantes electrónicos emitidos)",
    `- comprobantes_pdf/ (${p.pdfIncluidos} PDF)`,
    "",
    "IMPORTANTE: conservar la documentación fiscal emitida es obligación del taller.",
    "STApp no la retiene una vez completada la eliminación de la cuenta.",
  ]
  if (p.pendientes > 0) {
    lines.push(
      "",
      `AVISO: ${p.pendientes} PDF no se incluyeron en este archivo (tope de cantidad o tamaño, tiempo, o link no descargable).`,
      "Están listados con su link en pdfs-pendientes.csv. Descargalos desde esos links antes de que se complete la eliminación."
    )
  }
  return lines.join("\r\n") + "\r\n"
}

async function fetchByVentaIds(table: string, ventaIds: string[]): Promise<Row[]> {
  const out: Row[] = []
  for (let i = 0; i < ventaIds.length; i += IN_CHUNK) {
    const chunk = ventaIds.slice(i, i + IN_CHUNK)
    out.push(...(await fetchAllRows(table, "*", (q) => q.in("venta_id", chunk))))
  }
  return out
}

// Sin provider_response: es la respuesta cruda del proveedor y puede traer datos que no son del taller.
const COMPROBANTES_COLUMNS =
  "id, venta_id, tipo, punto_venta, numero, cae, cae_vencimiento, estado, pdf_url, receptor_doc_tipo, receptor_doc_nro, receptor_condicion_iva, total, provider, error_msg, created_at, updated_at"

export function buildOrganizationExportStream(
  org: { id: string; nombre: string; slug: string },
  opts: { fetchImpl?: typeof fetch } = {}
): ReadableStream<Uint8Array> {
  return buildZipStream(async (zip) => {
    const deadline = Date.now() + EXPORT_BUDGET_MS
    const byOrg = (q: { eq: (c: string, v: string) => unknown }) => q.eq("organization_id", org.id)

    zip.addText("clientes.csv", rowsToCsv(await fetchAllRows("clientes", "*", byOrg)))

    const ventas = await fetchAllRows("ventas", "*", byOrg)
    zip.addText("ventas.csv", rowsToCsv(ventas))
    const ventaIds = ventas.map((v) => String(v.id))
    zip.addText("ventas_items.csv", rowsToCsv(await fetchByVentaIds("items_venta", ventaIds)))
    zip.addText("ventas_pagos.csv", rowsToCsv(await fetchByVentaIds("pagos_venta", ventaIds)))

    // facturas no tiene organization_id: se une por la orden de servicio.
    const facturas = await fetchAllRows("facturas", "*, ordenes_servicio!inner(organization_id)", (q) =>
      q.eq("ordenes_servicio.organization_id", org.id)
    )
    zip.addText(
      "facturas.csv",
      rowsToCsv(facturas.map(({ ordenes_servicio: _union, ...rest }) => rest))
    )

    zip.addText("notas_credito.csv", rowsToCsv(await fetchAllRows("notas_credito", "*", byOrg)))
    zip.addText("cuenta_corriente.csv", rowsToCsv(await fetchAllRows("cuenta_corriente", "*", byOrg)))

    const comprobantes = await fetchAllRows("comprobantes_fiscales", COMPROBANTES_COLUMNS, byOrg)
    zip.addText("comprobantes_fiscales.csv", rowsToCsv(comprobantes))

    const { files, pending } = await collectPdfs(
      comprobantes
        .filter((c) => c.estado === "emitido")
        .map((c) => ({ id: String(c.id), numero: (c.numero as string | null) ?? null, pdf_url: (c.pdf_url as string | null) ?? null })),
      deadline,
      { fetchImpl: opts.fetchImpl }
    )
    for (const f of files) zip.addBytes(`comprobantes_pdf/${f.name}`, f.bytes, { store: true })
    if (pending.length > 0) zip.addText("pdfs-pendientes.csv", rowsToCsv(pending as unknown as Row[]))

    zip.addText(
      "LEEME.txt",
      buildReadme({ orgNombre: org.nombre, slug: org.slug, generadoEn: new Date(), pdfIncluidos: files.length, pendientes: pending.length })
    )
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/account-deletion/export-organization.test.ts` y `npx tsc --noEmit`
Expected: PASS (todos). Si `tsc` se queja del tipo de `byOrg`, tipar su parámetro como `any` con el mismo comentario `eslint-disable` de `fetchAllRows`.

- [ ] **Step 5: Commit**

```bash
git add lib/account-deletion/export-organization.ts __tests__/lib/account-deletion/export-organization.test.ts
git commit -m "feat(account-deletion): respaldo del taller en ZIP con topes y pendientes"
```

---

### Task 17: `GET /api/account/export`

**Files:**
- Create: `app/api/account/export/route.ts`
- Modify: `vercel.json` (60 s para esta ruta)
- Test: `__tests__/api/account-export.test.ts`

**Interfaces:**
- Consumes: `requireAdmin()`; `buildOrganizationExportStream(org)` (tarea 16).
- Produces: `GET /api/account/export` → `200` con `Content-Type: application/zip`, `Content-Disposition: attachment; filename="respaldo-{slug}-{YYYY-MM-DD}.zip"`, `Cache-Control: no-store`; `403` no ADMIN; `404`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockAuthError, mockSupabaseFrom, createChainMock } from "./helpers"

vi.mock("@/lib/account-deletion/export-organization", () => ({
  buildOrganizationExportStream: vi.fn(() =>
    new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0x50, 0x4b, 5, 6])); c.close() } })
  ),
}))
import { buildOrganizationExportStream } from "@/lib/account-deletion/export-organization"
import { GET } from "@/app/api/account/export/route"

describe("GET /api/account/export", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseFrom({ organizations: createChainMock({ id: "o1", nombre: "Taller Uno", slug: "taller-uno" }, null) })
  })

  it("sin sesión: 401", async () => {
    mockAuthError()
    expect((await GET()).status).toBe(401)
  })

  it.each(["TECNICO", "VENDEDOR"])("un %s recibe 403 y no se arma nada", async (role) => {
    mockAuthSuccess({ organizationId: "o1", role })
    expect((await GET()).status).toBe(403)
    expect(buildOrganizationExportStream).not.toHaveBeenCalled()
  })

  it("un ADMIN recibe el ZIP con nombre de archivo del taller y sin caché", async () => {
    mockAuthSuccess({ organizationId: "o1", role: "ADMIN" })
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/zip")
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="respaldo-taller-uno-\d{4}-\d{2}-\d{2}\.zip"$/)
    expect(new Uint8Array(await res.arrayBuffer())[0]).toBe(0x50)
    expect(buildOrganizationExportStream).toHaveBeenCalledWith({ id: "o1", nombre: "Taller Uno", slug: "taller-uno" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/account-export.test.ts`
Expected: FAIL con "Failed to resolve import @/app/api/account/export/route".

- [ ] **Step 3: Write minimal implementation**

`app/api/account/export/route.ts`:

```ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { buildOrganizationExportStream } from "@/lib/account-deletion/export-organization"

// El respaldo puede tardar: los PDFs se bajan del proveedor. Ver también la
// entrada de esta ruta en vercel.json (el glob de app/api/** limita a 30 s).
export const maxDuration = 60

// GET /api/account/export — ZIP con la información fiscal y comercial del taller,
// para descargar ANTES de confirmar la eliminación. Solo ADMIN.
export async function GET() {
  const { error, organizationId } = await requireAdmin()
  if (error) return error

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("id, nombre, slug")
    .eq("id", organizationId!)
    .single()
  if (!org) return NextResponse.json({ error: "Taller no encontrado" }, { status: 404 })

  const fecha = new Date().toISOString().slice(0, 10)
  return new Response(buildOrganizationExportStream({ id: org.id, nombre: org.nombre, slug: org.slug }), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="respaldo-${org.slug}-${fecha}.zip"`,
      "Cache-Control": "no-store",
    },
  })
}
```

En `vercel.json`, dentro de `"functions"`, agregar (con coma después del bloque anterior):

```json
    "app/api/account/export/route.ts": {
      "maxDuration": 60
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/api/account-export.test.ts`, `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))"` y `npx tsc --noEmit`
Expected: PASS (4 tests); JSON válido.

- [ ] **Step 5: Commit**

```bash
git add app/api/account/export/route.ts vercel.json __tests__/api/account-export.test.ts
git commit -m "feat(api): GET /api/account/export descarga el respaldo del taller en ZIP"
```

---

### Task 18: Registro con un email en período de gracia

**Files:**
- Modify: `app/api/auth/register/route.ts` (chequeo de email existente, líneas ~144-156)
- Test: `__tests__/api/register-cuenta-en-baja.test.ts`

**Interfaces:**
- Consumes: columnas `users.deleted_at` y `organizations.deletion_requested_at` (migración 338).
- Produces: `POST /api/auth/register` responde `400 { error: "Esta cuenta está en proceso de eliminación, escribí a soporte", code: "ACCOUNT_PENDING_DELETION" }` si el email pertenece a un usuario dado de baja **o** a un taller con `deletion_requested_at`; para el resto sigue respondiendo "Ya existe una cuenta con este email".

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createChainMock, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/email", () => ({ sendVerificationEmail: vi.fn().mockResolvedValue(undefined) }))

const validBody = {
  organizacion: { nombre: "Acme", slug: "acme" },
  usuario: { nombre: "Alice", email: "user@example.com", password: "supersecret" },
}

async function call(existingUser: unknown) {
  const { supabaseAdmin } = await import("@/lib/supabase")
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) =>
    table === "users" ? createChainMock(existingUser, null) : createChainMock(null, null)) as never)
  const { POST } = await import("@/app/api/auth/register/route")
  return parseResponse(await POST(createPostRequest(validBody) as never))
}

describe("register con un email que ya existe", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it("usuario dado de baja: mensaje de eliminación en curso", async () => {
    const { status, body } = await call({ id: "u1", deleted_at: "2026-10-05", organizations: { deletion_requested_at: null } })
    expect(status).toBe(400)
    expect(body.error).toBe("Esta cuenta está en proceso de eliminación, escribí a soporte")
    expect(body.code).toBe("ACCOUNT_PENDING_DELETION")
  })

  it("usuario de un taller que pidió eliminarse (los usuarios no llevan deleted_at): mismo mensaje", async () => {
    const { body } = await call({ id: "u1", deleted_at: null, organizations: { deletion_requested_at: "2026-10-05" } })
    expect(body.code).toBe("ACCOUNT_PENDING_DELETION")
  })

  it("la relación puede venir como arreglo", async () => {
    const { body } = await call({ id: "u1", deleted_at: null, organizations: [{ deletion_requested_at: "2026-10-05" }] })
    expect(body.code).toBe("ACCOUNT_PENDING_DELETION")
  })

  it("usuario normal: sigue diciendo que ya existe", async () => {
    const { status, body } = await call({ id: "u1", deleted_at: null, organizations: { deletion_requested_at: null } })
    expect(status).toBe(400)
    expect(body.error).toBe("Ya existe una cuenta con este email")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/register-cuenta-en-baja.test.ts`
Expected: FAIL: los tres primeros casos devuelven "Ya existe una cuenta con este email".

- [ ] **Step 3: Write minimal implementation**

En `app/api/auth/register/route.ts` reemplazar el bloque:

```ts
    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", userEmail)
      .single()

    if (existingUser) {
      return NextResponse.json(
        { error: "Ya existe una cuenta con este email" },
        { status: 400 }
      )
    }
```

por:

```ts
    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("id, deleted_at, organizations(deletion_requested_at)")
      .eq("email", userEmail)
      .single()

    if (existingUser) {
      // Dos formas de estar "en gracia": el usuario se dio de baja (users.deleted_at)
      // o su taller pidió eliminarse (organizations.deletion_requested_at; en ese
      // caso los usuarios NO llevan deleted_at).
      const rel = existingUser.organizations as
        | { deletion_requested_at?: string | null }
        | Array<{ deletion_requested_at?: string | null }>
        | null
      const org = Array.isArray(rel) ? rel[0] : rel
      if (existingUser.deleted_at || org?.deletion_requested_at) {
        return NextResponse.json(
          {
            error: "Esta cuenta está en proceso de eliminación, escribí a soporte",
            code: "ACCOUNT_PENDING_DELETION",
          },
          { status: 400 }
        )
      }
      return NextResponse.json(
        { error: "Ya existe una cuenta con este email" },
        { status: 400 }
      )
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/api/register-cuenta-en-baja.test.ts __tests__/api/register-email-sent.test.ts __tests__/api/register-rubro.test.ts` y `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit y cierre de PR2**

```bash
git add app/api/auth/register/route.ts __tests__/api/register-cuenta-en-baja.test.ts
git commit -m "feat(register): avisar que la cuenta esta en proceso de eliminacion"
```

**Cierre de PR2:**
- [ ] `npx eslint lib/account-deletion app/api/account app/api/auth/register`
- [ ] `npx tsc --noEmit` y `npx vitest run __tests__/lib/account-deletion __tests__/api/account-delete-user.test.ts __tests__/api/account-delete-organization.test.ts __tests__/api/account-deletion-info.test.ts __tests__/api/account-export.test.ts __tests__/api/register-cuenta-en-baja.test.ts`
- [ ] Prueba manual en un taller de prueba (con PR1 desplegado y migración aplicada): `curl` autenticado a `delete-user` con un TECNICO; ADMIN único → 409; `export` devuelve un ZIP que abre; verificar el mensaje de `ya cancelada` de MercadoPago con una suscripción de prueba (ver Open Questions).


---

# PR 3: UI

### Task 19: `isPublicPath` extraído a `lib/public-paths.ts` con `/legal` público

**Files:**
- Create: `lib/public-paths.ts`
- Modify: `middleware.ts` (borrar la función local, importar la nueva)
- Test: `__tests__/lib/public-paths.test.ts`

**Interfaces:**
- Produces: `PUBLIC_PATHS: readonly string[]` y `isPublicPath(pathname: string): boolean` (prefijo, igual que antes). Se extrae a un módulo porque `middleware.ts` no se puede importar en tests y la regla "`/legal/*` es pública en un subdominio sin sesión" es la que hace que la URL que se declara en Play Console funcione desde cualquier host.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { isPublicPath } from "@/lib/public-paths"

// Las rutas que eran públicas ANTES de este cambio no pueden dejar de serlo.
const HISTORICAS = [
  "/login", "/registro", "/forgot-password", "/reset-password", "/verificar-email", "/tenant-not-found",
  "/api/auth/session", "/api/public/catalogo/x", "/api/cron/x", "/api/mercadopago/webhook", "/api/rebill/webhook",
  "/api/creem/webhook", "/_next/static/a.js", "/favicon.ico", "/manifest.json", "/sw.js", "/logo.png", "/icons/a.png",
  "/seguimiento/abc", "/cotizacion/abc", "/kiosco", "/api/whatsapp/webhook", "/api/v1/x", "/api/health",
  "/app-entry", "/ayuda", "/descargar", "/google-auth",
]

describe("isPublicPath", () => {
  it.each(HISTORICAS)("%s sigue siendo pública", (p) => expect(isPublicPath(p)).toBe(true))

  it.each(["/legal", "/legal/eliminar-cuenta", "/legal/privacidad", "/legal/terminos"])(
    "%s es pública (la URL de Play Console tiene que abrir sin sesión, también desde un subdominio)",
    (p) => expect(isPublicPath(p)).toBe(true)
  )

  it.each(["/dashboard", "/perfil", "/ordenes", "/api/account/export", "/api/account/delete-user", "/api/users/profile"])(
    "%s sigue protegida",
    (p) => expect(isPublicPath(p)).toBe(false)
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/public-paths.test.ts`
Expected: FAIL con "Failed to resolve import @/lib/public-paths".

- [ ] **Step 3: Write minimal implementation**

`lib/public-paths.ts`:

```ts
// Rutas que no requieren autenticación. Vive acá y no dentro de middleware.ts
// porque el middleware no se puede importar en tests.
export const PUBLIC_PATHS = [
  "/login",
  "/registro",
  "/forgot-password",
  "/reset-password",
  "/verificar-email",
  "/tenant-not-found",
  "/api/auth",
  "/api/public",
  "/api/cron",
  "/api/mercadopago/webhook",
  "/api/rebill/webhook",
  "/api/creem/webhook",
  "/_next",
  "/favicon.ico",
  "/manifest.json",
  "/sw.js",
  "/logo.png",
  "/icons",
  "/seguimiento",
  "/cotizacion",
  "/kiosco",
  "/api/whatsapp/webhook",
  "/api/v1",
  "/api/health",
  "/app-entry",
  "/ayuda",
  "/descargar",
  "/google-auth",
  // Páginas legales, incluida /legal/eliminar-cuenta (URL declarada en Play Console).
  "/legal",
] as const

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname.startsWith(path))
}
```

En `middleware.ts`: agregar `import { isPublicPath } from "@/lib/public-paths"` junto a los imports y BORRAR la función local completa, desde el comentario `// Rutas públicas que no requieren autenticación` hasta el `}` que cierra `function isPublicPath(pathname: string): boolean { ... }` (líneas ~69-102). No se toca ninguno de sus usos.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/public-paths.test.ts` y `npx tsc --noEmit`; verificar `rg -n "function isPublicPath" middleware.ts lib/public-paths.ts` (una sola definición, en `lib/public-paths.ts`).
Expected: PASS (38 casos); tsc sin errores.

- [ ] **Step 5: Commit**

```bash
git add lib/public-paths.ts middleware.ts __tests__/lib/public-paths.test.ts
git commit -m "feat(middleware): /legal publico en subdominios y isPublicPath testeable"
```

---

### Task 20: Página pública `/legal/eliminar-cuenta` y enlaces en privacidad

**Files:**
- Create: `lib/account-deletion/urls.ts`
- Create: `components/legal/eliminar-cuenta-form.tsx`
- Create: `app/legal/eliminar-cuenta/page.tsx`
- Modify: `app/legal/privacidad/page.tsx` (§6 y §7)
- Test: `__tests__/lib/account-deletion/urls.test.ts`, `__tests__/components/eliminar-cuenta-form.test.tsx`

**Interfaces:**
- Produces: `isValidTenantSlug(raw: string): boolean` (mismo patrón que `app/app-entry/page.tsx`: `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` sobre el valor en minúsculas y sin espacios), `buildDeletionLoginUrl(slug: string, rootDomain: string): string` → `https://{slug}.{root}/login?callbackUrl=%2Fperfil%23eliminar` (equivale al `/perfil%23eliminar` del spec una vez decodificado); componente `EliminarCuentaForm`.

- [ ] **Step 1: Write the failing tests**

`__tests__/lib/account-deletion/urls.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { isValidTenantSlug, buildDeletionLoginUrl } from "@/lib/account-deletion/urls"

describe("isValidTenantSlug", () => {
  it.each([["taller-uno", true], ["  Taller-Uno ", true], ["a", true], ["-malo", false], ["malo-", false], ["con espacio", false], ["", false], ["acentó", false], ["a.b", false]])(
    "%j -> %s",
    (raw, ok) => expect(isValidTenantSlug(raw)).toBe(ok)
  )
})

describe("buildDeletionLoginUrl", () => {
  it("lleva al login del taller con callback a la Zona de peligro", () => {
    const url = buildDeletionLoginUrl("taller-uno", "stapp.com.ar")
    expect(url).toBe("https://taller-uno.stapp.com.ar/login?callbackUrl=%2Fperfil%23eliminar")
    expect(new URL(url).searchParams.get("callbackUrl")).toBe("/perfil#eliminar")
  })
})
```

`__tests__/components/eliminar-cuenta-form.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { EliminarCuentaForm } from "@/components/legal/eliminar-cuenta-form"

describe("EliminarCuentaForm", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", { value: { href: "" }, writable: true })
  })

  it("con un subdominio válido lleva al login del taller", () => {
    render(<EliminarCuentaForm />)
    fireEvent.change(screen.getByLabelText(/subdominio/i), { target: { value: "Taller-Uno" } })
    fireEvent.click(screen.getByRole("button", { name: /ir a mi cuenta/i }))
    expect(window.location.href).toBe("https://taller-uno.stapp.com.ar/login?callbackUrl=%2Fperfil%23eliminar")
  })

  it("con un subdominio inválido muestra el error y no navega", () => {
    render(<EliminarCuentaForm />)
    fireEvent.change(screen.getByLabelText(/subdominio/i), { target: { value: "no valido!" } })
    fireEvent.click(screen.getByRole("button", { name: /ir a mi cuenta/i }))
    expect(screen.getByRole("alert")).toHaveTextContent(/letras, números y guiones/i)
    expect(window.location.href).toBe("")
  })

  it("vacío: pide el subdominio", () => {
    render(<EliminarCuentaForm />)
    fireEvent.click(screen.getByRole("button", { name: /ir a mi cuenta/i }))
    expect(screen.getByRole("alert")).toHaveTextContent(/ingresá/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/account-deletion/urls.test.ts __tests__/components/eliminar-cuenta-form.test.tsx`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Write minimal implementation**

`lib/account-deletion/urls.ts`:

```ts
// Mismo patrón que la validación de slug de app/app-entry/page.tsx.
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

export function isValidTenantSlug(raw: string): boolean {
  return SLUG_PATTERN.test(raw.trim().toLowerCase())
}

// El callbackUrl lo respeta el login desde la tarea 21; `#eliminar` abre la
// pestaña de seguridad de /perfil y hace scroll a la Zona de peligro.
export function buildDeletionLoginUrl(slug: string, rootDomain: string): string {
  return `https://${slug}.${rootDomain}/login?callbackUrl=${encodeURIComponent("/perfil#eliminar")}`
}
```

`components/legal/eliminar-cuenta-form.tsx`:

```tsx
"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { buildDeletionLoginUrl, isValidTenantSlug } from "@/lib/account-deletion/urls"

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"

export function EliminarCuentaForm() {
  const [slug, setSlug] = useState("")
  const [error, setError] = useState("")

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const clean = slug.trim().toLowerCase()
    if (!clean) return setError("Ingresá el subdominio de tu taller")
    if (!isValidTenantSlug(clean)) return setError("Solo letras, números y guiones (sin espacios)")
    window.location.href = buildDeletionLoginUrl(clean, ROOT_DOMAIN)
  }

  return (
    <form onSubmit={submit} className="space-y-3 not-prose" noValidate>
      <Label htmlFor="slug-eliminar">Subdominio de tu taller</Label>
      <div className="flex items-center gap-2">
        <Input
          id="slug-eliminar"
          value={slug}
          onChange={(e) => { setSlug(e.target.value); setError("") }}
          placeholder="mi-taller"
          autoCapitalize="none"
          autoCorrect="off"
          aria-invalid={!!error}
        />
        <span className="text-sm text-muted-foreground whitespace-nowrap">.{ROOT_DOMAIN}</span>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit">Ir a mi cuenta</Button>
    </form>
  )
}
```

`app/legal/eliminar-cuenta/page.tsx`:

```tsx
import { Metadata } from "next"
import { CONTACT_EMAIL } from "@/lib/contact"
import { GRACE_DAYS } from "@/lib/account-deletion/state"
import { EliminarCuentaForm } from "@/components/legal/eliminar-cuenta-form"

export const metadata: Metadata = {
  title: "Eliminar mi cuenta | STApp",
  description: "Cómo eliminar tu usuario o tu taller de STApp, qué se borra y qué se conserva.",
  // Explícito: Next hereda el canonical del layout raíz y lo apuntaría a la home.
  alternates: { canonical: "https://stapp.com.ar/legal/eliminar-cuenta" },
}

export default function EliminarCuentaPage() {
  return (
    <article className="prose prose-gray max-w-none">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Eliminar mi cuenta</h1>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Cómo hacerlo</h2>
        <p className="text-gray-600 mb-4">
          Ingresá el subdominio de tu taller, iniciá sesión y vas a llegar a la sección “Zona de peligro” de tu perfil.
          Es el mismo camino que ofrece la app. Por seguridad te pedimos tu contraseña (o tu email si usás Google) y,
          si lo tenés activado, el código de verificación en dos pasos.
        </p>
        <EliminarCuentaForm />
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Dos opciones</h2>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li><strong>Eliminar mi usuario:</strong> cualquier usuario puede hacerlo. El taller sigue funcionando.</li>
          <li><strong>Eliminar el taller:</strong> solo un administrador. Elimina la organización, sus datos y cancela la suscripción. Antes podés descargar un respaldo.</li>
        </ul>
        <p className="text-gray-600 mt-4">
          El último administrador de un taller no puede eliminar solo su usuario: tiene que eliminar el taller o pasarle el rol de administrador a otra persona.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Qué se elimina y qué se conserva</h2>
        <h3 className="text-lg font-medium text-gray-900 mt-6 mb-3">Al eliminar un usuario</h3>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li>Se borran tu nombre, email, teléfono, foto, contraseña y datos de verificación en dos pasos.</li>
          <li>Las operaciones que registraste (ventas, órdenes, caja) se conservan para el taller y quedan firmadas como “Usuario eliminado”.</li>
        </ul>
        <h3 className="text-lg font-medium text-gray-900 mt-6 mb-3">Al eliminar un taller</h3>
        <ul className="list-disc list-inside text-gray-600 space-y-2 ml-4">
          <li>Se cancela la suscripción en el momento y el acceso se desactiva.</li>
          <li>Después del plazo se borran todos los datos del taller: clientes, órdenes, ventas, inventario, comprobantes y archivos.</li>
          <li>La documentación fiscal emitida debe conservarla el taller: descargá el respaldo antes de confirmar. STApp no retiene nada pasado el plazo.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Plazos</h2>
        <p className="text-gray-600">
          La desactivación es inmediata. Durante {GRACE_DAYS} días podemos revertir el pedido si te arrepentís. Pasado ese plazo
          el borrado es definitivo y no se puede deshacer.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">¿No podés ingresar?</h2>
        <p className="text-gray-600">
          Escribinos a <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 hover:underline">{CONTACT_EMAIL}</a> desde el
          email de tu cuenta y te ayudamos con el pedido.
        </p>
      </section>
    </article>
  )
}
```

`app/legal/privacidad/page.tsx`: agregar `import Link from "next/link"` y reemplazar los dos párrafos finales de §6 y §7:

- §6, de `Puede solicitar la eliminación de sus datos en cualquier momento contactándonos.` a:
```tsx
          Puede eliminar su usuario o su taller en cualquier momento desde la sección “Zona de peligro” de su perfil, o
          siguiendo las instrucciones en <Link href="/legal/eliminar-cuenta" className="text-blue-600 hover:underline">Eliminar mi cuenta</Link>.
          Conservamos los datos durante 30 días para poder revertir el pedido y después los borramos de forma definitiva.
```
- §7, de `Para ejercer estos derechos, puede hacerlo desde la configuración de su cuenta.` a:
```tsx
          Para ejercer estos derechos, puede hacerlo desde su perfil. La eliminación de la cuenta se explica en{" "}
          <Link href="/legal/eliminar-cuenta" className="text-blue-600 hover:underline">Eliminar mi cuenta</Link>.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/account-deletion/urls.test.ts __tests__/components/eliminar-cuenta-form.test.tsx` y `npx tsc --noEmit`; verificar a mano `rg -n "eliminar-cuenta" app/legal/privacidad/page.tsx` (2 enlaces).
Expected: PASS; tsc sin errores.

- [ ] **Step 5: Commit**

```bash
git add lib/account-deletion/urls.ts components/legal/eliminar-cuenta-form.tsx app/legal/eliminar-cuenta/page.tsx app/legal/privacidad/page.tsx __tests__/lib/account-deletion/urls.test.ts __tests__/components/eliminar-cuenta-form.test.tsx
git commit -m "feat(legal): pagina publica de eliminacion de cuenta y enlaces en privacidad"
```

---

### Task 21: El login respeta `callbackUrl` (sin open redirect)

**Files:**
- Create: `lib/safe-callback-path.ts`
- Modify: `app/(auth)/login/page.tsx` (dos redirecciones a `/dashboard`)
- Test: `__tests__/lib/safe-callback-path.test.ts`

**Interfaces:**
- Produces: `safeCallbackPath(raw: string | null | undefined, fallback?: string): string` — solo devuelve rutas relativas del mismo origen; todo lo demás cae al `fallback` (`"/dashboard"`).
- Esto cambia el comportamiento de TODAS las rutas protegidas: el middleware ya setea `?callbackUrl=` al mandar a `/login`, pero el login lo ignoraba. A partir de ahora el usuario vuelve a la página que quería. Decirlo en la descripción del PR.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { safeCallbackPath } from "@/lib/safe-callback-path"

describe("safeCallbackPath", () => {
  it.each([
    ["/perfil#eliminar", "/perfil#eliminar"],
    ["/ordenes?estado=abierta", "/ordenes?estado=abierta"],
    ["/perfil", "/perfil"],
  ])("acepta la ruta relativa %s", (raw, esperado) => expect(safeCallbackPath(raw)).toBe(esperado))

  it.each([
    null, undefined, "", "/", "/login", "/login?x=1",
    "//evil.com", "//evil.com/x", "/\\evil.com", "\\\\evil.com",
    "https://evil.com", "http://evil.com", "javascript:alert(1)", "perfil", "/ok\n//evil.com", "/api/users/profile",
  ])("rechaza %j y cae al dashboard", (raw) => expect(safeCallbackPath(raw as string | null | undefined)).toBe("/dashboard"))

  it("acepta un fallback propio", () => {
    expect(safeCallbackPath("//evil.com", "/inicio")).toBe("/inicio")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/safe-callback-path.test.ts`
Expected: FAIL con "Failed to resolve import @/lib/safe-callback-path".

- [ ] **Step 3: Write minimal implementation**

`lib/safe-callback-path.ts`:

```ts
/**
 * Destino post-login a partir del `callbackUrl` de la query. Solo rutas
 * relativas del mismo origen: `//host`, `/\host`, esquemas (`https:`,
 * `javascript:`) y caracteres de control son open redirect y caen al fallback.
 * `/`, `/login*` y `/api/*` tampoco sirven como destino de un login.
 */
export function safeCallbackPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw) return fallback
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback
  if (/[\u0000-\u001f]/.test(raw)) return fallback
  if (raw === "/" || raw.startsWith("/login") || raw.startsWith("/api/")) return fallback
  return raw
}
```

En `app/(auth)/login/page.tsx`: importar `import { safeCallbackPath } from "@/lib/safe-callback-path"` y reemplazar las DOS apariciones de `window.location.href = "/dashboard"` por:

```tsx
window.location.href = safeCallbackPath(searchParams.get("callbackUrl"))
```

(`searchParams` ya existe en el componente, línea ~53.) Antes de editar, confirmar con `rg -c 'window.location.href = "/dashboard"' "app/(auth)/login/page.tsx"` que son exactamente 2.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/safe-callback-path.test.ts` y `npx tsc --noEmit`; `rg -n 'safeCallbackPath' "app/(auth)/login/page.tsx"` debe mostrar el import y 2 usos.
Expected: PASS (24 casos); tsc sin errores.

- [ ] **Step 5: Commit**

```bash
git add lib/safe-callback-path.ts "app/(auth)/login/page.tsx" __tests__/lib/safe-callback-path.test.ts
git commit -m "fix(login): respetar callbackUrl del middleware con saneado anti open redirect"
```

---

### Task 22: Campos de reautenticación y cierre de sesión tras la baja

**Files:**
- Create: `components/perfil/reauth-fields.tsx`
- Create: `components/perfil/cerrar-sesion-tras-baja.ts`
- Test: `__tests__/components/reauth-fields.test.tsx`

**Interfaces:**
- Consumes: `ReauthInput` (tarea 10).
- Produces:
  - `ReauthValue = { password: string; email: string; totpCode: string }`, `EMPTY_REAUTH`
  - `isReauthComplete(v: ReauthValue, hasPassword: boolean, totpEnabled: boolean): boolean`
  - `toReauthPayload(v: ReauthValue, hasPassword: boolean, totpEnabled: boolean): ReauthInput`
  - `<ReauthFields hasPassword totpEnabled value onChange disabled? idPrefix? />`
  - `cerrarSesionTrasBaja(): Promise<void>` — limpia tokens PWA, `signOut({ redirect: false })` y manda a `/app-entry` en nativo o a la landing (`https://{root}/`) en web.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ReauthFields, EMPTY_REAUTH, isReauthComplete, toReauthPayload } from "@/components/perfil/reauth-fields"

describe("helpers de reautenticación", () => {
  it("usuario con contraseña: completa cuando hay password (y TOTP si corresponde)", () => {
    expect(isReauthComplete(EMPTY_REAUTH, true, false)).toBe(false)
    expect(isReauthComplete({ ...EMPTY_REAUTH, password: "x" }, true, false)).toBe(true)
    expect(isReauthComplete({ ...EMPTY_REAUTH, password: "x" }, true, true)).toBe(false)
    expect(isReauthComplete({ ...EMPTY_REAUTH, password: "x", totpCode: "123456" }, true, true)).toBe(true)
  })

  it("usuario Google: se pide el email, no la contraseña", () => {
    expect(isReauthComplete({ ...EMPTY_REAUTH, password: "x" }, false, false)).toBe(false)
    expect(isReauthComplete({ ...EMPTY_REAUTH, email: " a@b.com " }, false, false)).toBe(true)
  })

  it("el payload solo lleva lo que corresponde", () => {
    expect(toReauthPayload({ password: "p", email: "e@x.com", totpCode: "1" }, true, false)).toEqual({ password: "p" })
    expect(toReauthPayload({ password: "p", email: " e@x.com ", totpCode: " 123456 " }, false, true)).toEqual({ email: "e@x.com", totpCode: "123456" })
  })
})

describe("<ReauthFields>", () => {
  const base = { value: EMPTY_REAUTH, onChange: vi.fn() }

  it("pide contraseña a quien tiene; no pide email ni código", () => {
    render(<ReauthFields {...base} hasPassword totpEnabled={false} />)
    expect(screen.getByLabelText(/contraseña/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/tu email/i)).toBeNull()
    expect(screen.queryByLabelText(/código/i)).toBeNull()
  })

  it("pide el email a quien usa Google y el código a quien tiene 2FA", () => {
    render(<ReauthFields {...base} hasPassword={false} totpEnabled />)
    expect(screen.getByLabelText(/tu email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/código/i)).toBeInTheDocument()
  })

  it("propaga los cambios sin pisar los otros campos", () => {
    const onChange = vi.fn()
    render(<ReauthFields value={{ ...EMPTY_REAUTH, totpCode: "9" }} onChange={onChange} hasPassword totpEnabled />)
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: "abc" } })
    expect(onChange).toHaveBeenCalledWith({ password: "abc", email: "", totpCode: "9" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/reauth-fields.test.tsx`
Expected: FAIL con "Failed to resolve import @/components/perfil/reauth-fields".

- [ ] **Step 3: Write minimal implementation**

`components/perfil/reauth-fields.tsx`:

```tsx
"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ReauthInput } from "@/lib/account-deletion/types"

export interface ReauthValue {
  password: string
  email: string
  totpCode: string
}

export const EMPTY_REAUTH: ReauthValue = { password: "", email: "", totpCode: "" }

export function isReauthComplete(v: ReauthValue, hasPassword: boolean, totpEnabled: boolean): boolean {
  const credencial = hasPassword ? v.password.length > 0 : v.email.trim().length > 0
  return credencial && (!totpEnabled || v.totpCode.trim().length > 0)
}

export function toReauthPayload(v: ReauthValue, hasPassword: boolean, totpEnabled: boolean): ReauthInput {
  const payload: ReauthInput = hasPassword ? { password: v.password } : { email: v.email.trim() }
  if (totpEnabled) payload.totpCode = v.totpCode.trim()
  return payload
}

interface Props {
  hasPassword: boolean
  totpEnabled: boolean
  value: ReauthValue
  onChange: (next: ReauthValue) => void
  disabled?: boolean
  idPrefix?: string
}

export function ReauthFields({ hasPassword, totpEnabled, value, onChange, disabled, idPrefix = "reauth" }: Props) {
  return (
    <div className="space-y-3">
      {hasPassword ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-password`}>Tu contraseña</Label>
          <Input
            id={`${idPrefix}-password`}
            type="password"
            autoComplete="current-password"
            value={value.password}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, password: e.target.value })}
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-email`}>Tipeá tu email para confirmar</Label>
          <Input
            id={`${idPrefix}-email`}
            type="email"
            autoComplete="off"
            value={value.email}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, email: e.target.value })}
          />
        </div>
      )}
      {totpEnabled && (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-totp`}>Código de verificación en dos pasos</Label>
          <Input
            id={`${idPrefix}-totp`}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={value.totpCode}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, totpCode: e.target.value })}
          />
        </div>
      )}
    </div>
  )
}
```

`components/perfil/cerrar-sesion-tras-baja.ts`:

```ts
import { signOut } from "next-auth/react"
import { isNativePlatform } from "@/lib/capacitor"

/**
 * Cierra la sesión local después de eliminar el usuario o el taller. Mismo
 * circuito que el logout del navbar; el destino es /app-entry en la app nativa
 * y la landing en web (el subdominio del taller ya no existe o ya no te sirve).
 */
export async function cerrarSesionTrasBaja(): Promise<void> {
  try {
    const { clearPWATokens } = await import("@/components/auth/session-refresher")
    await clearPWATokens()
  } catch {
    // best effort: el signOut de abajo es lo que importa
  }
  await signOut({ redirect: false })

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  if (isNativePlatform()) {
    try {
      localStorage.removeItem("stapp-tenant-slug")
    } catch {
      // storage bloqueado
    }
    window.location.href = `https://${rootDomain}/app-entry`
  } else {
    window.location.href = `https://${rootDomain}/`
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/components/reauth-fields.test.tsx` y `npx tsc --noEmit`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add components/perfil/reauth-fields.tsx components/perfil/cerrar-sesion-tras-baja.ts __tests__/components/reauth-fields.test.tsx
git commit -m "feat(perfil): campos de reautenticacion y cierre de sesion tras la baja"
```

---

### Task 23: Diálogo "Eliminar mi usuario"

**Files:**
- Create: `components/perfil/eliminar-usuario-dialog.tsx`
- Test: `__tests__/components/eliminar-usuario-dialog.test.tsx`

**Interfaces:**
- Consumes: `DeletionInfo`, `ReauthFields`/helpers (tarea 22), `cerrarSesionTrasBaja` (22), `POST /api/account/delete-user` (12).
- Produces: `<EliminarUsuarioDialog open onOpenChange info />`. Éxito: toast y `cerrarSesionTrasBaja()`. Error (401/409/500): muestra `data.error` dentro del diálogo y NO cierra sesión.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("@/components/perfil/cerrar-sesion-tras-baja", () => ({ cerrarSesionTrasBaja: vi.fn().mockResolvedValue(undefined) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { cerrarSesionTrasBaja } from "@/components/perfil/cerrar-sesion-tras-baja"
import { EliminarUsuarioDialog } from "@/components/perfil/eliminar-usuario-dialog"
import type { DeletionInfo } from "@/lib/account-deletion/types"

const info = (over: Partial<DeletionInfo> = {}): DeletionInfo => ({
  role: "TECNICO", slug: "taller-uno", orgName: "Taller Uno",
  isLastAdmin: false, hasPassword: true, totpEnabled: false, graceDays: 30, ...over,
})

const boton = () => screen.getByRole("button", { name: /eliminar mi usuario/i })

describe("EliminarUsuarioDialog", () => {
  beforeEach(() => vi.clearAllMocks())

  it("explica qué se borra y qué se conserva", () => {
    render(<EliminarUsuarioDialog open onOpenChange={() => {}} info={info()} />)
    expect(screen.getByText(/Usuario eliminado/)).toBeInTheDocument()
    expect(screen.getByText(/30 días/)).toBeInTheDocument()
  })

  it("el botón queda deshabilitado hasta completar la contraseña", () => {
    render(<EliminarUsuarioDialog open onOpenChange={() => {}} info={info()} />)
    expect(boton()).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: "abc" } })
    expect(boton()).toBeEnabled()
  })

  it("éxito: manda la reautenticación, avisa y cierra la sesión", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    render(<EliminarUsuarioDialog open onOpenChange={() => {}} info={info()} />)
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: "abc" } })
    fireEvent.click(boton())
    await waitFor(() => expect(cerrarSesionTrasBaja).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith("/api/account/delete-user", expect.objectContaining({
      method: "POST", body: JSON.stringify({ password: "abc" }),
    }))
  })

  it("contraseña incorrecta: muestra el error del servidor y NO cierra la sesión", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Contraseña incorrecta", code: "WRONG_CREDENTIAL" }), { status: 401 })))
    render(<EliminarUsuarioDialog open onOpenChange={() => {}} info={info()} />)
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: "mala" } })
    fireEvent.click(boton())
    expect(await screen.findByRole("alert")).toHaveTextContent("Contraseña incorrecta")
    expect(cerrarSesionTrasBaja).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/eliminar-usuario-dialog.test.tsx`
Expected: FAIL con "Failed to resolve import @/components/perfil/eliminar-usuario-dialog".

- [ ] **Step 3: Write minimal implementation**

```tsx
"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { DeletionInfo } from "@/lib/account-deletion/types"
import { ReauthFields, EMPTY_REAUTH, isReauthComplete, toReauthPayload, type ReauthValue } from "./reauth-fields"
import { cerrarSesionTrasBaja } from "./cerrar-sesion-tras-baja"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  info: DeletionInfo
}

export function EliminarUsuarioDialog({ open, onOpenChange, info }: Props) {
  const [value, setValue] = useState<ReauthValue>(EMPTY_REAUTH)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = !loading && isReauthComplete(value, info.hasPassword, info.totpEnabled)

  const submit = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/account/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toReauthPayload(value, info.hasPassword, info.totpEnabled)),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "No pudimos eliminar tu usuario")
        return
      }
      toast.success("Tu usuario fue eliminado")
      await cerrarSesionTrasBaja()
    } catch {
      setError("Error de conexión. Reintentá.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Eliminar mi usuario</DialogTitle>
          <DialogDescription>Esta acción cierra tu sesión y no se puede deshacer por tu cuenta.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">Se borran:</strong> tu nombre, email, teléfono, foto, contraseña y la
            verificación en dos pasos.
          </p>
          <p>
            <strong className="text-foreground">Se conservan:</strong> las operaciones que registraste (ventas, órdenes, caja)
            quedan en el taller, firmadas como “Usuario eliminado”.
          </p>
          <p>
            Tus datos se anonimizan de forma definitiva a los {info.graceDays} días. Hasta entonces podés pedirle a soporte
            que lo revierta.
          </p>
        </div>

        <ReauthFields
          idPrefix="eliminar-usuario"
          hasPassword={info.hasPassword}
          totpEnabled={info.totpEnabled}
          value={value}
          onChange={setValue}
          disabled={loading}
        />

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancelar</Button>
          <Button variant="destructive" onClick={submit} disabled={!canSubmit}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Eliminar mi usuario
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/components/eliminar-usuario-dialog.test.tsx` y `npx tsc --noEmit`
Expected: PASS (4 tests). Si Radix necesita `DialogTitle` accesible, ya está incluido.

- [ ] **Step 5: Commit**

```bash
git add components/perfil/eliminar-usuario-dialog.tsx __tests__/components/eliminar-usuario-dialog.test.tsx
git commit -m "feat(perfil): dialogo para eliminar el propio usuario"
```

---

### Task 24: Diálogo "Eliminar el taller" con respaldo

**Files:**
- Create: `components/perfil/eliminar-taller-dialog.tsx`
- Test: `__tests__/components/eliminar-taller-dialog.test.tsx`

**Interfaces:**
- Consumes: `DeletionInfo`, `ReauthFields`/helpers, `cerrarSesionTrasBaja`, `GET /api/account/export` (17), `POST /api/account/delete-organization` (13).
- Produces: `<EliminarTallerDialog open onOpenChange info />`. Para confirmar hay que: tildar "Descargué mi respaldo o no lo necesito", tipear el subdominio exacto y reautenticarse. El texto aclara que conservar la documentación fiscal es obligación del taller.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("@/components/perfil/cerrar-sesion-tras-baja", () => ({ cerrarSesionTrasBaja: vi.fn().mockResolvedValue(undefined) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { cerrarSesionTrasBaja } from "@/components/perfil/cerrar-sesion-tras-baja"
import { EliminarTallerDialog } from "@/components/perfil/eliminar-taller-dialog"
import type { DeletionInfo } from "@/lib/account-deletion/types"

const info: DeletionInfo = {
  role: "ADMIN", slug: "taller-uno", orgName: "Taller Uno",
  isLastAdmin: false, hasPassword: true, totpEnabled: false, graceDays: 30,
}
const boton = () => screen.getByRole("button", { name: /eliminar el taller/i })

function llenar({ backup = true, slug = "taller-uno", password = "abc" } = {}) {
  if (backup) fireEvent.click(screen.getByLabelText(/descargué mi respaldo/i))
  fireEvent.change(screen.getByLabelText(/subdominio del taller/i), { target: { value: slug } })
  fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: password } })
}

describe("EliminarTallerDialog", () => {
  beforeEach(() => vi.clearAllMocks())

  it("ofrece el respaldo y recuerda que la documentación fiscal es del taller", () => {
    render(<EliminarTallerDialog open onOpenChange={() => {}} info={info} />)
    expect(screen.getByRole("link", { name: /descargar respaldo/i })).toHaveAttribute("href", "/api/account/export")
    expect(screen.getByText(/obligación del taller/i)).toBeInTheDocument()
  })

  it("no habilita el botón sin tildar el respaldo", () => {
    render(<EliminarTallerDialog open onOpenChange={() => {}} info={info} />)
    llenar({ backup: false })
    expect(boton()).toBeDisabled()
  })

  it("no habilita el botón si el subdominio no coincide", () => {
    render(<EliminarTallerDialog open onOpenChange={() => {}} info={info} />)
    llenar({ slug: "otro" })
    expect(boton()).toBeDisabled()
  })

  it("con todo completo envía el pedido y cierra la sesión", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, deletionDate: "2026-11-04T00:00:00Z" }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    render(<EliminarTallerDialog open onOpenChange={() => {}} info={info} />)
    llenar({ slug: " Taller-Uno " })
    expect(boton()).toBeEnabled()
    fireEvent.click(boton())
    await waitFor(() => expect(cerrarSesionTrasBaja).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith("/api/account/delete-organization", expect.objectContaining({
      method: "POST", body: JSON.stringify({ confirmSlug: " Taller-Uno ", password: "abc" }),
    }))
  })

  it("502: muestra el mensaje de soporte y NO cierra la sesión", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "No pudimos cancelar tu suscripción, reintentá o escribí a soporte" }), { status: 502 })))
    render(<EliminarTallerDialog open onOpenChange={() => {}} info={info} />)
    llenar()
    fireEvent.click(boton())
    expect(await screen.findByRole("alert")).toHaveTextContent(/No pudimos cancelar tu suscripción/)
    expect(cerrarSesionTrasBaja).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/eliminar-taller-dialog.test.tsx`
Expected: FAIL con "Failed to resolve import @/components/perfil/eliminar-taller-dialog".

- [ ] **Step 3: Write minimal implementation**

```tsx
"use client"

import { useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { DeletionInfo } from "@/lib/account-deletion/types"
import { ReauthFields, EMPTY_REAUTH, isReauthComplete, toReauthPayload, type ReauthValue } from "./reauth-fields"
import { cerrarSesionTrasBaja } from "./cerrar-sesion-tras-baja"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  info: DeletionInfo
}

export function EliminarTallerDialog({ open, onOpenChange, info }: Props) {
  const [backupHecho, setBackupHecho] = useState(false)
  const [slug, setSlug] = useState("")
  const [value, setValue] = useState<ReauthValue>(EMPTY_REAUTH)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const slugOk = slug.trim().toLowerCase() === info.slug
  const canSubmit = !loading && backupHecho && slugOk && isReauthComplete(value, info.hasPassword, info.totpEnabled)

  const submit = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/account/delete-organization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmSlug: slug, ...toReauthPayload(value, info.hasPassword, info.totpEnabled) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "No pudimos eliminar el taller")
        return
      }
      toast.success("El taller fue desactivado y la suscripción cancelada")
      await cerrarSesionTrasBaja()
    } catch {
      setError("Error de conexión. Reintentá.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Eliminar el taller</DialogTitle>
          <DialogDescription>
            Se desactiva el acceso de todo el equipo y se cancela la suscripción ahora. Pasados {info.graceDays} días se borran
            todos los datos de forma definitiva.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">1. Descargá tu respaldo</p>
          <p className="text-sm text-muted-foreground">
            ZIP con clientes, ventas, facturas, notas de crédito, cuenta corriente y comprobantes fiscales. Conservar la
            documentación fiscal es obligación del taller: STApp no retiene nada después del plazo.
          </p>
          <Button asChild variant="outline" size="sm">
            <a href="/api/account/export" download>
              <Download className="mr-2 h-4 w-4" />
              Descargar respaldo
            </a>
          </Button>
          <div className="flex items-center gap-2 pt-1">
            <input
              id="backup-hecho"
              type="checkbox"
              checked={backupHecho}
              onChange={(e) => setBackupHecho(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="backup-hecho" className="font-normal">Descargué mi respaldo o no lo necesito</Label>
          </div>
        </section>

        <section className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">2. Confirmá</p>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-slug">
              Escribí el subdominio del taller (<span className="font-mono">{info.slug}</span>)
            </Label>
            <Input id="confirm-slug" value={slug} onChange={(e) => setSlug(e.target.value)} autoCapitalize="none" autoCorrect="off" disabled={loading} aria-label="Subdominio del taller" />
          </div>
          <ReauthFields
            idPrefix="eliminar-taller"
            hasPassword={info.hasPassword}
            totpEnabled={info.totpEnabled}
            value={value}
            onChange={setValue}
            disabled={loading}
          />
        </section>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancelar</Button>
          <Button variant="destructive" onClick={submit} disabled={!canSubmit}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Eliminar el taller
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

Nota: el campo del subdominio lleva `aria-label="Subdominio del taller"` además del `<Label>`; si el test encuentra dos coincidencias para `getByLabelText(/subdominio del taller/i)`, quitar el `aria-label` y dejar solo el `<Label htmlFor>` cambiando su texto a "Subdominio del taller: escribí `{info.slug}`".

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/components/eliminar-taller-dialog.test.tsx` y `npx tsc --noEmit`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add components/perfil/eliminar-taller-dialog.tsx __tests__/components/eliminar-taller-dialog.test.tsx
git commit -m "feat(perfil): dialogo para eliminar el taller con respaldo y confirmacion"
```

---

### Task 25: Zona de peligro en `/perfil`

**Files:**
- Create: `components/perfil/zona-de-peligro.tsx`
- Modify: `app/(dashboard)/perfil/page.tsx`
- Test: `__tests__/components/zona-de-peligro.test.tsx`

**Interfaces:**
- Consumes: `GET /api/account/deletion-info` (14), `EliminarUsuarioDialog` (23), `EliminarTallerDialog` (24), `DeletionInfo`.
- Produces: `<ZonaDePeligro />` — Card con `id="eliminar"`. TECNICO/VENDEDOR ven solo "Eliminar mi usuario". ADMIN ve también "Eliminar el taller". Si es el último ADMIN, "Eliminar mi usuario" aparece deshabilitado con la explicación y el camino alternativo. Deep link: `/perfil#eliminar` abre la pestaña "Seguridad" y hace scroll a la tarjeta.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { ZonaDePeligro } from "@/components/perfil/zona-de-peligro"
import type { DeletionInfo } from "@/lib/account-deletion/types"

const info = (over: Partial<DeletionInfo> = {}): DeletionInfo => ({
  role: "TECNICO", slug: "taller-uno", orgName: "Taller Uno",
  isLastAdmin: false, hasPassword: true, totpEnabled: false, graceDays: 30, ...over,
})

function mockInfo(i: DeletionInfo) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(i), { status: 200 })))
}

describe("ZonaDePeligro", () => {
  beforeEach(() => vi.clearAllMocks())

  it("un técnico solo puede eliminar su usuario", async () => {
    mockInfo(info())
    render(<ZonaDePeligro />)
    expect(await screen.findByRole("button", { name: /eliminar mi usuario/i })).toBeEnabled()
    expect(screen.queryByRole("button", { name: /eliminar el taller/i })).toBeNull()
  })

  it("un administrador puede eliminar su usuario y el taller", async () => {
    mockInfo(info({ role: "ADMIN" }))
    render(<ZonaDePeligro />)
    expect(await screen.findByRole("button", { name: /eliminar el taller/i })).toBeEnabled()
    expect(screen.getByRole("button", { name: /eliminar mi usuario/i })).toBeEnabled()
  })

  it("el último administrador no puede eliminar solo su usuario: ve el motivo y el camino alternativo", async () => {
    mockInfo(info({ role: "ADMIN", isLastAdmin: true }))
    render(<ZonaDePeligro />)
    expect(await screen.findByRole("button", { name: /eliminar mi usuario/i })).toBeDisabled()
    expect(screen.getByText(/único administrador/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /eliminar el taller/i })).toBeEnabled()
  })

  it("si no se puede cargar la información no ofrece ninguna acción destructiva", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })))
    render(<ZonaDePeligro />)
    await waitFor(() => expect(screen.getByText(/no pudimos cargar/i)).toBeInTheDocument())
    expect(screen.queryByRole("button", { name: /eliminar/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/zona-de-peligro.test.tsx`
Expected: FAIL con "Failed to resolve import @/components/perfil/zona-de-peligro".

- [ ] **Step 3: Write minimal implementation**

`components/perfil/zona-de-peligro.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { DeletionInfo } from "@/lib/account-deletion/types"
import { EliminarUsuarioDialog } from "./eliminar-usuario-dialog"
import { EliminarTallerDialog } from "./eliminar-taller-dialog"

export function ZonaDePeligro() {
  const [info, setInfo] = useState<DeletionInfo | null>(null)
  const [failed, setFailed] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  const [orgOpen, setOrgOpen] = useState(false)

  useEffect(() => {
    fetch("/api/account/deletion-info", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("deletion-info"))))
      .then(setInfo)
      .catch(() => setFailed(true))
  }, [])

  // Deep link de /legal/eliminar-cuenta: /perfil#eliminar
  useEffect(() => {
    if (info && typeof window !== "undefined" && window.location.hash === "#eliminar") {
      document.getElementById("eliminar")?.scrollIntoView?.({ behavior: "smooth", block: "start" })
    }
  }, [info])

  return (
    <Card id="eliminar" className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          Zona de peligro
        </CardTitle>
        <CardDescription>Acciones permanentes sobre tu cuenta.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {failed && <p className="text-sm text-muted-foreground">No pudimos cargar esta sección. Recargá la página.</p>}

        {info && (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">Eliminar mi usuario</p>
                <p className="text-sm text-muted-foreground">
                  Borra tus datos personales. Tus operaciones quedan en el taller como “Usuario eliminado”.
                </p>
                {info.isLastAdmin && (
                  <p className="text-sm text-amber-600">
                    Sos el único administrador del taller. Para eliminar tu usuario, eliminá el taller o pasale el rol de
                    administrador a otra persona desde la gestión de usuarios.
                  </p>
                )}
              </div>
              <Button variant="destructive" disabled={info.isLastAdmin} onClick={() => setUserOpen(true)}>
                Eliminar mi usuario
              </Button>
            </div>

            {info.role === "ADMIN" && (
              <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Eliminar el taller</p>
                  <p className="text-sm text-muted-foreground">
                    Desactiva el acceso de todo el equipo, cancela la suscripción y borra los datos a los {info.graceDays} días.
                    Podés descargar un respaldo antes.
                  </p>
                </div>
                <Button variant="destructive" onClick={() => setOrgOpen(true)}>
                  Eliminar el taller
                </Button>
              </div>
            )}

            <EliminarUsuarioDialog open={userOpen} onOpenChange={setUserOpen} info={info} />
            {info.role === "ADMIN" && <EliminarTallerDialog open={orgOpen} onOpenChange={setOrgOpen} info={info} />}
          </>
        )}
      </CardContent>
    </Card>
  )
}
```

`app/(dashboard)/perfil/page.tsx`, cuatro ediciones:

1. Import, después de `import { PushSettings } from "@/components/notifications/push-settings"`:
```tsx
import { ZonaDePeligro } from "@/components/perfil/zona-de-peligro"
```
2. Estado, después de `const fileInputRef = useRef<HTMLInputElement>(null)`:
```tsx
  const [tab, setTab] = useState("general")
```
3. Efecto, inmediatamente después del primer `useEffect` (el que hace el `fetch("/api/users/profile")`) y ANTES del `if (loading)` (los hooks no pueden ir después de un return condicional):
```tsx
  // Deep link de /legal/eliminar-cuenta: /perfil#eliminar abre la pestaña de seguridad.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#eliminar") setTab("seguridad")
  }, [])
```
4. `<Tabs defaultValue="general">` → `<Tabs value={tab} onValueChange={setTab}>`, y al final del `TabsContent value="seguridad"`, después del bloque `{profile && (<SecuritySettings totpEnabled={profile.totpEnabled} />)}`, agregar:
```tsx
          <ZonaDePeligro />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/components/zona-de-peligro.test.tsx __tests__/components/eliminar-usuario-dialog.test.tsx __tests__/components/eliminar-taller-dialog.test.tsx` y `npx tsc --noEmit`
Expected: PASS. Verificar a mano en `npm run dev` (en un worktree con dependencias): abrir `/perfil#eliminar` con sesión → abre "Seguridad" y baja a la tarjeta.

- [ ] **Step 5: Commit y cierre de PR3**

```bash
git add components/perfil/zona-de-peligro.tsx "app/(dashboard)/perfil/page.tsx" __tests__/components/zona-de-peligro.test.tsx
git commit -m "feat(perfil): zona de peligro con eliminacion de usuario y de taller"
```

**Cierre de PR3:**
- [ ] `npx eslint components/perfil components/legal app/legal lib/public-paths.ts lib/safe-callback-path.ts "app/(dashboard)/perfil" "app/(auth)/login" middleware.ts`
- [ ] `npx tsc --noEmit` y `npx vitest run __tests__/components/zona-de-peligro.test.tsx __tests__/components/eliminar-usuario-dialog.test.tsx __tests__/components/eliminar-taller-dialog.test.tsx __tests__/components/reauth-fields.test.tsx __tests__/components/eliminar-cuenta-form.test.tsx __tests__/lib/public-paths.test.ts __tests__/lib/safe-callback-path.test.ts __tests__/lib/account-deletion/urls.test.ts`
- [ ] Descripción del PR: mencionar el cambio global del login con `callbackUrl` y que `/legal/*` pasa a ser público en subdominios.

---

## Despliegue y verificación final (de punta a punta)

1. Aplicar la migración 338 a mano (dry-run y luego `--apply`) **antes** de mergear PR1; correr `verify/338_probes.sql` y el procedimiento de dos sesiones.
2. Mergear PR1 → PR2 → PR3 en orden (cada uno retargeteado a `main` al mergear el anterior). El cron queda en dry-run: revisar su log (`results.orgs.candidates`) durante varios días.
3. En un taller de prueba: (a) un TECNICO elimina su usuario → no puede loguearse, sigue firmando como "Usuario eliminado" en lo histórico después de anonimizar; (b) ADMIN único → botón deshabilitado; (c) eliminar el taller con una suscripción de prueba en cada proveedor → verificar que cada proveedor la cancela y confirmar el mensaje real de "ya cancelada" de MercadoPago (ajustar `isAlreadyCanceledError` si no matchea); (d) descargar el respaldo y abrir el ZIP; (e) restaurar desde el panel de superadmin y comprobar que `deletion_requested_at` queda en `NULL`.
4. Activar `ACCOUNT_DELETION_PURGE_ENABLED=true` en Vercel solo después de (3).
5. Declarar `https://stapp.com.ar/legal/eliminar-cuenta` en Play Console y actualizar Data Safety.

## Self-Review

**Spec coverage.** Modelo de datos y función SQL: T1. Restore limpia la columna: T6. Flujo A (ubicación, modal, reauth, endpoint con guarda, tokens push, email a ADMIN): T10-T12, T22-T23, T25. Flujo B (respaldo ZIP con topes, confirmación con subdominio, cancelación con 502 sin cambios, campos seteados, emails): T13, T15-T17, T24. Página pública (explica, campo de subdominio con la validación de `app-entry`, `CONTACT_EMAIL`, `/legal` en `isPublicPath`, enlaces en privacidad §6/§7): T19-T20. Cron (auth, dry-run, solo `deletion_requested_at` vencido, lotes y 60 s): T7. `purgeOrganization` (suscripciones, storage recursivo, fila; idempotente; corta): T3-T4 y reutilizada en T6. `anonymizeUser`: T5. Tabla de errores: 502 (T13), purga que corta (T4/T7), webhooks (T9), tope de PDFs (T16), registro en gracia (T18), último ADMIN 409 (T12). Seguridad: reauth (T10), impersonación (T12/T13 + middleware existente), concurrencia (T1), sesiones vivas (T8, con el desvío 2). Tests del spec: cubiertos en cada tarea; la "página pública renderiza sin sesión desde dominio principal y subdominio" queda como T19 (regla de `isPublicPath`) más el render de T20; no hay test que ejecute el middleware completo (no es importable) y se verifica en la prueba manual del paso 3 del despliegue.

**Placeholder scan.** Sin `TBD`/`TODO`. Los puntos que dependen de información externa están explicitados como Open Questions y no como huecos de código.

**Type consistency.** `PurgeResult`/`PurgeOptions` (T4) coinciden con su uso en el cron (T7) y el superadmin (T6). `CancelResult` (T2) se usa igual en T4 y T13. `ReauthInput`/`DeletionInfo` (T10, T14) se consumen en T22-T25. `ReauthResult.status` es siempre `401` y las rutas lo devuelven tal cual. `ZipWriter`/`rowsToCsv` (T15) coinciden con T16. `catalogoOrgHash` (T3) se usa en T3 y su test.

**Review Focus.** (1) dos ADMIN simultáneos: T1 (SQL + probes) y T12; (2) fallo parcial de proveedores y reintento: T2 (`isAlreadyCanceledError`) y T13; (3) storage: T3; (4) taller restaurado antes de la purga: T4 y T7; (5) respaldo con negativos/fórmulas/paginación/host no permitido: T15 y T16. Extras con test propio: `callbackUrl` hostil (T21) y `/legal` público en subdominio (T19).

## Open Questions (necesitan decisión o dato del usuario)

1. **Host real de los PDFs de TusFacturas.** Se asumió `tusfacturas.app` en `PDF_ALLOWED_HOST_SUFFIXES` (el spike de TusFacturas sigue pendiente). Si el host real es otro, esos PDFs caen en `pdfs-pendientes.csv` con su link (falla segura), pero conviene confirmarlo antes de activar.
2. **Mensaje real de "ya cancelada" de MercadoPago/Rebill.** `isAlreadyCanceledError` es una heurística sobre el texto del error; se confirma en la prueba manual con una suscripción de prueba.
3. **`users.activo = false` al darse de baja** (desvío 6): oculta al usuario de las listas de técnicos durante la gracia, pero hay que acordarse de ponerlo en `true` al restaurar. ¿Aceptable, o se prefiere no tocar `activo` y filtrar por `deleted_at` en las listas?
4. **El login con `callbackUrl`** cambia el comportamiento de todas las rutas protegidas (el usuario vuelve a donde quería ir). ¿Se acepta en este PR o se prefiere un PR aparte?
5. **Tamaño de PR1** (~950 líneas): ¿se parte en PR1a/PR1b como se describe arriba?
