# Deploy de Evolution API en Hetzner Cloud (VPS)

Plan B de `whatsapp-evolution-oracle-deploy.md` cuando Oracle ARM no tiene cupo ("Out of capacity"). Hetzner tiene capacidad garantizada y es lo más confiable para un servicio always-on. Costo ~**€3.79–4.5/mes**.

> El resto del stack (Docker, docker-compose, Cloudflare Tunnel, conexión a STApp) es **idéntico** al doc de Oracle. Este doc solo cambia la **Parte 1 (provisionar el servidor)**; después seguís el doc de Oracle desde la Parte 2.

---

## Por qué Hetzner

- **Capacidad real**: no hay lotería de cupo como el ARM free de Oracle.
- **Always-on de verdad**: VPS dedicado, no se duerme.
- Mismo `docker-compose` corre igual (la imagen de Evolution es multi-arch: anda en ARM y x86).

---

## Parte 1 — Provisionar el servidor

1. Creá cuenta en **Hetzner Cloud** (https://console.hetzner.cloud). Cuentas nuevas a veces piden verificación de identidad/pago — normal.
2. Creá un **Project** (ej. `stapp-whatsapp`).
3. **Add Server**:
   - **Location**: **Ashburn (US-East)** o **Hillsboro (US-West)** — más cerca de Argentina = menos latencia. (EU Falkenstein también sirve; la latencia no es crítica acá.)
   - **Image**: **Ubuntu 22.04**.
   - **Type**:
     - **CAX11** (Arm64, 2 vCPU / 4 GB / 40 GB, ~€3.79/mes) — **recomendado**, el más barato y alcanza sobrado.
     - Alternativa x86: **CX22** (2 vCPU / 4 GB, ~€4.5/mes).
   - **SSH key**: agregá tu clave pública (Add SSH key → pegás tu `id_ed25519.pub` o `id_rsa.pub`). Sin esto no entrás.
   - **Firewall**: opcional. Si lo activás, permití **solo inbound TCP 22 (SSH)**. Con Cloudflare Tunnel **no** necesitás abrir 80/443 (el túnel sale por conexión saliente).
   - El resto (volumes, backups, placement): default. Backups de Hetzner (+20%) son opcionales — recomendable si querés snapshot automático de la sesión.
4. **Create & Buy now**.

Anotá la **IP pública** del server.

> Generá tu key SSH si no tenés: `ssh-keygen -t ed25519 -C "stapp-evolution"` → la pública queda en `~/.ssh/id_ed25519.pub`.

---

## Partes 2 a 5 — Idénticas al doc de Oracle

Seguí **`docs/whatsapp-evolution-oracle-deploy.md`** desde la **Parte 2**, con un solo ajuste: el usuario SSH de Hetzner Ubuntu es **`root`**, no `ubuntu`.

```bash
ssh root@TU_IP_PUBLICA
```

Resumen de lo que viene (todo igual que el doc de Oracle):

- **Parte 2** — instalar Docker + compose plugin. (Como entrás como `root`, podés omitir el `usermod -aG docker` / `newgrp`.)
- **Parte 3** — `~/evolution/docker-compose.yml` con Evolution + Postgres + Redis. **Mismo archivo, sin cambios.** Acordate de:
  - poner una `AUTHENTICATION_API_KEY` real (`openssl rand -hex 32`),
  - cambiar `evopass` por una contraseña real,
  - dejar `SERVER_URL=https://evo.tudominio.com` (tu hostname del Tunnel).
- **Parte 4** — Cloudflare Tunnel.
  - El binario ARM (`cloudflared-linux-arm64`) sirve para **CAX11**. Si elegiste **CX22 (x86)**, usá `cloudflared-linux-amd64` en vez de `arm64`.
  - En `config.yml`, el `credentials-file` queda bajo `/root/.cloudflared/...` (no `/home/ubuntu/...`), porque entrás como root.
- **Parte 5** — conectar en STApp (Base URL, Instance name, API key) y seguir con la Parte B del doc de pruebas (QR pairing → toggle → prueba de cambio de estado).

---

## Diferencias clave vs Oracle (checklist rápido)

| | Oracle | Hetzner |
|---|---|---|
| Usuario SSH | `ubuntu` | **`root`** |
| `credentials-file` del tunnel | `/home/ubuntu/.cloudflared/…` | `/root/.cloudflared/…` |
| Binario cloudflared | `arm64` | `arm64` (CAX11) / `amd64` (CX22) |
| Firewall | no tocar (tunnel) | opcional, solo SSH 22 |
| Costo | gratis (si hay cupo) | ~€4/mes (garantizado) |

Todo lo demás (compose, env vars, smoke `curl`, seguridad, troubleshooting) es igual — usá las secciones del doc de Oracle.

---

## Operación

- **Backups**: activá Hetzner Backups (+20%) o sacá snapshots manuales. El volumen con la sesión de WhatsApp vive en los volúmenes Docker (`postgres_data`, `evolution_instances`); si el server muere sin backup, re-escaneás el QR.
- **Costo**: ~€4/mes fijo. Apagar el server NO ahorra (se cobra igual mientras exista); para pausar gasto hay que borrarlo (y perdés la sesión salvo snapshot).
- **Riesgo de baneo**: Evolution es WhatsApp no oficial. Para uso comercial de volumen, evaluá migrar a **Meta Cloud API** (oficial) — STApp ya lo soporta.
