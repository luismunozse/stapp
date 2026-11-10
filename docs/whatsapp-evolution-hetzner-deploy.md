# Evolution API en Hetzner Cloud (producción)

Servidor Evolution de producción de STApp: `https://evo.stapp.com.ar`. Se armó en Hetzner porque Oracle ARM no tenía cupo ("Out of capacity"); `whatsapp-evolution-oracle-deploy.md` queda como alternativa gratuita.

La diferencia principal con el doc de Oracle: el HTTPS lo pone **Caddy**, dentro del mismo compose, con los puertos 80 y 443 abiertos. **No hay Cloudflare Tunnel.**

---

## Cómo está armado hoy

| | |
|---|---|
| Server | `ubuntu-4gb-hel1-1` en la consola de Hetzner: **CX23** (x86, 2 vCPU, 4 GB, 40 GB), Helsinki |
| Dominio | `evo.stapp.com.ar`: registro A directo a la IP del server, sin proxy de Cloudflare |
| Stack | `/root/evolution/`: `docker-compose.yml` y `Caddyfile` (proyecto `evolution`) |
| Acceso | `ssh root@evo.stapp.com.ar`, solo con clave SSH |

| Servicio | Imagen | Puertos |
|---|---|---|
| `evolution-api` | `evoapicloud/evolution-api:v2.3.7` | `127.0.0.1:8080`, solo local |
| `caddy` | `caddy:2-alpine` | `80` y `443`, públicos |
| `postgres` | `postgres:16-alpine` | interno |
| `redis` | `redis:7-alpine` | interno |

Caddy recibe el tráfico de `evo.stapp.com.ar` y se lo pasa a `evolution-api`; los demás contenedores no quedan expuestos. STApp se conecta con `EVOLUTION_BASE_URL=https://evo.stapp.com.ar` y `EVOLUTION_API_KEY` (el `AUTHENTICATION_API_KEY` del compose) en las variables de entorno de Vercel. Cada taller solo escanea su QR.

Los archivos completos están más abajo, en *Configuración del server*.

---

## Acceso

```bash
ssh root@evo.stapp.com.ar
```

- Se entra **solo con clave SSH**. No dependas de la contraseña de root.
- Huella del server (ED25519): `SHA256:zUvFLMUUFsrsYOE803Lo1cp9dAankCjQd5KaoqqTWas`. Si al conectarte aparece otra, estás en el modo rescate o el server cambió.
- Guardá una copia de la clave privada (`~/.ssh/id_ed25519`) en un gestor de contraseñas. Si se pierde, la única vuelta es el modo rescate.

### Si perdiste la clave

Así se recuperó el acceso el 2026-09-28. Mientras el server está en modo rescate, Evolution queda caído (unos minutos).

1. En tu PC, generá una clave nueva. Si ya tenés un `id_ed25519` que usás para otra cosa (GitHub, otro server), no lo pises: generala con otro nombre (`-f`) y conectate con `ssh -i`.
   ```
   ssh-keygen -t ed25519
   ```
2. Hetzner → **Security → SSH keys → Add SSH key**: pegá la pública (`id_ed25519.pub`).
3. Server → **Rescue → Enable rescue & power cycle**, con `linux64` y esa clave. Tiene que ser la opción con *power cycle*: sin el reinicio, el server sigue en el Ubuntu normal.
4. Entrá al rescate. El prompt dice `root@rescue` y la huella es distinta de la de arriba:
   ```
   ssh-keygen -R evo.stapp.com.ar
   ssh root@evo.stapp.com.ar
   ```
5. Copiá la clave al disco del server y reiniciá:
   ```bash
   mount /dev/sda1 /mnt
   mkdir -p /mnt/root/.ssh
   echo 'ssh-ed25519 AAAA...tu-clave-publica' >> /mnt/root/.ssh/authorized_keys
   chmod 700 /mnt/root/.ssh; chmod 600 /mnt/root/.ssh/authorized_keys
   umount /mnt
   reboot
   ```
6. El rescate se desactiva solo. Cuando el server vuelva: `ssh-keygen -R evo.stapp.com.ar` y `ssh root@evo.stapp.com.ar`.

---

## Operación

```bash
cd /root/evolution
docker compose ps                            # los 4 contenedores tienen que estar Up
docker compose logs --tail 50 evolution-api
```

- **Cambiar una variable**: `cp docker-compose.yml docker-compose.yml.bak`, editá y corré `docker compose up -d`. Recrea solo el contenedor que cambió. Después confirmá en STApp (Configuración → WhatsApp) que siga conectado, y pasá el cambio a la copia de este doc.
- **Cambiar el `Caddyfile`**: editalo y corré `docker compose restart caddy`. El `up -d` no alcanza, porque el compose no cambió.
- **`DATABASE_SAVE_DATA_NEW_MESSAGE=true` es obligatoria**: con `false`, los reintentos de WhatsApp le llegan vacíos al cliente (ver el troubleshooting de `whatsapp-evolution-oracle-deploy.md`). Se corrigió el 2026-09-28.
- **Firewall**: si activás el de Hetzner, abrí TCP **22** (SSH), **80** y **443** (Caddy). Con solo el 22, `evo.stapp.com.ar` deja de responder y se cortan todos los WhatsApp automáticos.
- **"Esperando el mensaje. Esto puede tardar un tiempo" en los WhatsApp automáticos**: el teléfono del cliente no puede descifrar el mensaje. Con Evolution ≤ v2.2 pasa porque su Baileys (6.x) no soporta los identificadores LID que WhatsApp usa desde 2025. Se corrige actualizando a v2.3.x (Baileys 7), ver *Actualizar a v2.3.7* abajo.
- **Actualizar Evolution**: cambiá el tag de la imagen (siempre fijo, nunca `latest`), corré `docker compose pull && docker compose up -d` y verificá que la sesión sobreviva.
- **Backups**: Hetzner Backups o snapshots manuales. La sesión de WhatsApp vive en los volúmenes `postgres_data` y `evolution_instances`, y los certificados HTTPS en `caddy_data` (en `docker volume ls` aparecen con el prefijo `evolution_`). Si el server muere sin backup, hay que reescanear el QR.
- **Costo**: fijo mientras el server exista; apagarlo no ahorra. El precio vigente está en la consola de Hetzner.
- **Riesgo de baneo**: Evolution es WhatsApp no oficial. Para volumen comercial, evaluá **Meta Cloud API** (oficial); STApp ya lo soporta.

---

## Actualizar a v2.3.7 (desde v2.1.1)

La imagen cambió de nombre a partir de v2.2: `atendai/` → `evoapicloud/`.

```bash
cd /root/evolution
# 1. Backup: snapshot en Hetzner o dump de la base + copia del compose
docker compose exec -T postgres pg_dump -U evo evolution > /root/evolution-backup-$(date +%F).sql
cp docker-compose.yml docker-compose.yml.v2.1.1.bak

# 2. Editar docker-compose.yml:
#    image: evoapicloud/evolution-api:v2.3.7
#    quitar CONFIG_SESSION_PHONE_VERSION
#    agregar DATABASE_CONNECTION_CLIENT_NAME=evolution_exchange

# 3. Aplicar (corre las migraciones de Prisma al arrancar)
docker compose pull evolution-api && docker compose up -d evolution-api
docker compose logs -f --tail 100 evolution-api   # esperar "HTTP - ON: 8080"

# 4. Verificar
curl -s https://evo.stapp.com.ar/ | grep -o '"version":"[^"]*"'   # 2.3.7
```

Después, en STApp (Configuración → WhatsApp y por sucursal) confirmá que cada instancia siga `open` y mandá un envío de prueba a un número que antes mostraba "Esperando el mensaje". Si alguna instancia quedó `close`, reescaneá el QR.

**Rollback**: `cp docker-compose.yml.v2.1.1.bak docker-compose.yml && docker compose up -d evolution-api`. Si las migraciones ya corrieron y v2.1.1 no arranca, restaurá el dump (`psql -U evo evolution < backup.sql` sobre una base vacía).

---

## Configuración del server

Copia de `/root/evolution/` al 2026-11-10 (actualización a v2.3.7), con los secretos reemplazados por marcadores. Si cambiás algo en el server, actualizá también esta copia.

`docker-compose.yml`:

```yaml
services:
  evolution-api:
    image: evoapicloud/evolution-api:v2.3.7
    restart: always
    depends_on:
      - postgres
      - redis
    environment:
      - SERVER_URL=https://evo.stapp.com.ar
      - AUTHENTICATION_API_KEY=TU_API_KEY_SECRETA
      - DATABASE_ENABLED=true
      - DATABASE_PROVIDER=postgresql
      - DATABASE_CONNECTION_CLIENT_NAME=evolution_exchange
      - DATABASE_CONNECTION_URI=postgresql://evo:TU_PASSWORD_POSTGRES@postgres:5432/evolution?schema=public
      - DATABASE_SAVE_DATA_INSTANCE=true
      - DATABASE_SAVE_DATA_NEW_MESSAGE=true
      - CACHE_REDIS_ENABLED=true
      - CACHE_REDIS_URI=redis://redis:6379/0
      - CACHE_REDIS_PREFIX_KEY=evolution
      - CACHE_LOCAL_ENABLED=false
    ports:
      - "127.0.0.1:8080:8080"
    volumes:
      - evolution_instances:/evolution/instances

  caddy:
    image: caddy:2-alpine
    restart: always
    depends_on:
      - evolution-api
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config

  postgres:
    image: postgres:16-alpine
    restart: always
    environment:
      - POSTGRES_USER=evo
      - POSTGRES_PASSWORD=TU_PASSWORD_POSTGRES
      - POSTGRES_DB=evolution
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    restart: always
    volumes:
      - redis_data:/data

volumes:
  evolution_instances:
  postgres_data:
  redis_data:
  caddy_data:
  caddy_config:
```

`Caddyfile`:

```
evo.stapp.com.ar {
    reverse_proxy evolution-api:8080
}
```

- `TU_API_KEY_SECRETA`: la misma que `EVOLUTION_API_KEY` en Vercel. Para generar una nueva: `openssl rand -hex 32`.
- `TU_PASSWORD_POSTGRES`: va en dos lugares, `DATABASE_CONNECTION_URI` y `POSTGRES_PASSWORD`, y tiene que ser la misma en los dos.
- `CONFIG_SESSION_PHONE_VERSION`: desde v2.3 ya no se fija; Evolution toma sola la versión vigente de WhatsApp Web. Dejarla fija con un valor viejo hace que WhatsApp rechace la conexión. Solo agregala si el QR deja de aparecer (ver troubleshooting del doc de Oracle).
- `DATABASE_CONNECTION_CLIENT_NAME=evolution_exchange`: tiene que coincidir con el `clientName` que ya usaba la base, si no Evolution no encuentra las instancias existentes.
- Caddy saca y renueva solo el certificado HTTPS de `evo.stapp.com.ar`, y lo guarda en `caddy_data`.

---

## Armarlo de cero

1. **Server**: Hetzner Cloud → **Add Server** → Ubuntu LTS, tipo **CX23** (x86, 2 vCPU / 4 GB / 40 GB) o equivalente, cualquier location (hoy es Helsinki). Cargá tu clave SSH al crearlo.
2. **Docker**: Parte 2 de `whatsapp-evolution-oracle-deploy.md`. Como entrás como `root`, salteá el `usermod -aG docker` / `newgrp`.
3. **Archivos**: `mkdir -p /root/evolution` y creá adentro el `docker-compose.yml` y el `Caddyfile` de *Configuración del server*, con los secretos completados.
4. **DNS y firewall**: registro A de `evo.stapp.com.ar` a la IP nueva (como hoy, sin proxy de Cloudflare) y los puertos 22, 80 y 443 abiertos.
5. **Levantar y probar**:
   ```bash
   cd /root/evolution && docker compose up -d
   curl -s https://evo.stapp.com.ar/instance/fetchInstances -H "apikey: TU_API_KEY_SECRETA"
   ```
   Tiene que devolver JSON (`[]` en un server nuevo), no un error de auth.
6. **STApp**: si cambió la API key, actualizá `EVOLUTION_API_KEY` en Vercel. Cada taller vuelve a escanear su QR en Configuración → WhatsApp.
