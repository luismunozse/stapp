# STApp — Suite E2E (Playwright)

Tests end-to-end para STApp. Cubren autenticación, órdenes (con su máquina de
estados), técnicos, dashboard/reportes, pagos/caja y performance/UX.

## La realidad multi-tenant (leé esto primero)

STApp resuelve la organización por **subdominio** (`{slug}.stapp.com.ar`). En
`localhost` no hay subdominio, así que el middleware lo trata como dominio raíz:
las rutas protegidas redirigen a `/login` y el login desde la raíz reenvía a
`{slug}.stapp.com.ar`. **Conclusión:** los flujos autenticados NO corren en
localhost; necesitan apuntar a un **tenant de QA dedicado**.

Por eso la suite está partida en dos:

| Tipo | Archivos | Corre en |
|------|----------|----------|
| **Público** (sin sesión) | `login.spec.ts`, `public-pages.spec.ts`, `health.spec.ts`, `auth.spec.ts` | localhost o tenant |
| **Autenticado** | `*.auth.spec.ts` | sólo tenant QA con credenciales |

Sin credenciales, los specs autenticados **se saltan** (skip) — la suite queda
en verde igual.

## Estructura

```
e2e/
├── auth.setup.ts            # login único -> guarda storageState
├── auth.spec.ts             # Módulo 1: auth (público + sesión real)
├── ordenes.auth.spec.ts     # Módulo 2: crear/editar + máquina de estados
├── tecnicos.auth.spec.ts    # Módulo 3: técnicos + asignación
├── dashboard.auth.spec.ts   # Módulo 4: dashboard + filtros + reportes
├── pagos.auth.spec.ts       # Módulo 5: caja + cobro de órdenes
├── performance.auth.spec.ts # Módulo 6: performance & UX
├── login.spec.ts            # (existente) presencia de formulario
├── public-pages.spec.ts     # (existente) landing, registro, redirects
├── health.spec.ts           # (existente) contrato de /api/health
├── fixtures/
│   ├── auth.ts              # test extendido + skip si no hay credenciales
│   └── data.ts              # factories de datos (orden, técnico)
└── helpers/
    ├── selectors.ts         # selectores semánticos + constantes de dominio
    └── utils.ts             # console watcher, login, helpers de espera
```

> No hay `data-testid` en la app, así que todo selector es semántico
> (`getByRole`/`getByLabel`/`getByText`) y vive centralizado en
> `helpers/selectors.ts`.

## Configuración local

1. Instalar navegadores:
   ```bash
   npm run test:e2e:install        # chromium
   npm run test:e2e:install:all    # chromium + firefox
   ```

2. Para los flujos **autenticados**, exportá las variables de entorno (o creá un
   `.env.test` cargado por tu shell — está gitignored):

   ```bash
   export STAPP_TEST_URL=https://qa.stapp.com.ar   # subdominio del tenant QA
   export STAPP_TEST_EMAIL=qa@stapp.com.ar         # usuario QA (idealmente ADMIN)
   export STAPP_TEST_PASSWORD=********
   ```

   Variables opcionales:
   - `PW_FIREFOX=1` — corre los specs autenticados también en Firefox.
   - `E2E_MUTATE=1` — habilita tests que mutan caja (abrir/cerrar). Sólo en un
     tenant desechable.

   > ⚠️ Nunca apuntes a una organización productiva: los tests de crear/cobrar
   > **escriben datos reales**. Usá un tenant de QA con datos sembrados.

3. Prerrequisitos de datos en el tenant QA: **se siembran automáticamente**.
   `auth.setup.ts` ejecuta un seed idempotente vía API (`fixtures/seed.ts`)
   tras el login, garantizando:
   - cliente `QA-SEED-CLIENTE`
   - orden `QA-SEED-EQUIPO` (estado `RECIBIDO`)
   - técnico `QA-SEED-TECNICO` (`qa-seed-tecnico@e2e.local`)
   - vendedor `QA-SEED-VENDEDOR` (`qa-seed-vendedor@e2e.local`)

   Para correrlo a mano:
   ```bash
   npm run test:e2e:seed   # solo login + seed (proyecto "setup")
   ```
   El seed pasa por las rutas REST reales (`POST /api/clientes`, `/api/ordenes`,
   `/api/tecnicos`, `/api/vendedores`), respeta validación, contadores y
   multi-tenancy. No toca la DB por fuera.

   > El usuario del seed (`STAPP_TEST_EMAIL`) **debe ser ADMIN**: crear técnicos y
   > vendedores requiere rol ADMIN. El email de cada usuario sembrado es único
   > global, por eso van namespaced a `@e2e.local`.

## Comandos

```bash
npm run test:e2e          # toda la suite (autenticados se saltan si no hay creds)
npm run test:e2e:ui       # modo UI interactivo
npm run test:e2e:headed   # con navegador visible
npm run test:e2e:debug    # debugger paso a paso
npm run test:e2e:firefox  # incluye Firefox (cross-browser)
npm run test:e2e:report   # abre el último reporte HTML
```

Filtrar por módulo:
```bash
npx playwright test ordenes          # sólo órdenes
npx playwright test auth.spec.ts     # sólo auth
npx playwright test --project=public-chromium   # sólo públicos
```

## Cómo funciona la autenticación

`auth.setup.ts` es un proyecto "setup" que loguea **una sola vez** contra el
tenant y guarda la sesión en `e2e/.auth/user.json` (gitignored). Los proyectos
`authenticated-*` reusan esa sesión vía `storageState`, así ningún spec re-loguea.

Si no hay credenciales, el setup escribe un `storageState` vacío y se saltea; los
specs autenticados se saltan vía `fixtures/auth.ts`.

## Estrategia de detección de bugs

Cada spec, según aplica, verifica:
- **5xx**: `serverErrors` falla si alguna respuesta es ≥500.
- **Errores de consola**: `consoleWatcher.unexpected()` (con allowlist de ruido
  conocido) debe quedar vacío.
- **Estado/persistencia**: lo creado aparece luego en el listado.
- **Validación**: campos requeridos y rangos (ej. comisión 0-100) muestran error.
- **Máquina de estados**: el selector de estado sólo ofrece transiciones válidas
  (derivadas de `lib/orden-state-machine.ts`).
- **Responsive**: dashboard usable a 375px sin overflow horizontal.
- **Loops**: no más de ~40 requests en 3s sobre una página asentada.

## CI

- `ci.yml` → job `e2e`: corre los specs **públicos** sobre un build con env
  mockeada (`NEXT_PUBLIC_ROOT_DOMAIN=localhost`). Ya existía.
- `playwright.yml` → suite **completa** contra el tenant QA usando los secrets
  `STAPP_TEST_URL`, `STAPP_TEST_EMAIL`, `STAPP_TEST_PASSWORD`. Sube el reporte
  HTML como artifact y comenta el resumen en el PR. Si los secrets no están
  configurados, los autenticados se saltan y el job queda verde.

### Secrets a configurar en GitHub
`Settings → Secrets and variables → Actions`:
- `STAPP_TEST_URL`
- `STAPP_TEST_EMAIL`
- `STAPP_TEST_PASSWORD`
