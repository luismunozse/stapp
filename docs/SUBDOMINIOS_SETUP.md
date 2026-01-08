# Configuración de Subdominios por Tenant - STAPP

Esta guía explica cómo configurar subdominios para multi-tenancy en producción.

---

## Resumen

El sistema permite que cada organización tenga su propio subdominio:
- `stapp.com.ar` → Landing page pública
- `guru-tech.stapp.com.ar` → Dashboard de "Guru Tech"
- `mi-negocio.stapp.com.ar` → Dashboard de "Mi Negocio"

---

## 1. Configuración DNS

### Opción A: Vercel (Recomendado)

En tu proveedor de DNS (donde compraste el dominio), agregá estos registros:

| Tipo | Nombre | Valor | TTL |
|------|--------|-------|-----|
| A | @ | 76.76.21.21 | 3600 |
| CNAME | * | cname.vercel-dns.com | 3600 |
| CNAME | www | cname.vercel-dns.com | 3600 |

> **Nota**: El registro `*` es el wildcard que permite todos los subdominios.

### Opción B: Servidor propio

| Tipo | Nombre | Valor | TTL |
|------|--------|-------|-----|
| A | @ | TU_IP_SERVIDOR | 3600 |
| A | * | TU_IP_SERVIDOR | 3600 |
| CNAME | www | stapp.com.ar | 3600 |

---

## 2. Variables de Entorno

### En Vercel Dashboard

Ir a: **Project Settings → Environment Variables**

Agregar las siguientes variables para **Production**:

```env
# Dominio raíz (SIN https://)
NEXT_PUBLIC_ROOT_DOMAIN=stapp.com.ar

# Dominio de cookies (CON punto inicial para compartir entre subdominios)
COOKIE_DOMAIN=.stapp.com.ar

# URL de NextAuth (dominio principal)
NEXTAUTH_URL=https://stapp.com.ar

# Secret de NextAuth (generar uno seguro)
NEXTAUTH_SECRET=tu-secret-seguro-de-32-caracteres-minimo
```

### Generar NEXTAUTH_SECRET seguro

```bash
openssl rand -base64 32
```

---

## 3. Configuración en Vercel

### Agregar dominios

1. Ir a **Project Settings → Domains**
2. Agregar:
   - `stapp.com.ar` (dominio principal)
   - `*.stapp.com.ar` (wildcard para subdominios)

### Verificar configuración

Vercel mostrará instrucciones específicas si necesita verificación adicional.

---

## 4. Certificado SSL

### Vercel (Automático)

Vercel genera certificados SSL automáticamente para:
- El dominio principal
- Todos los subdominios (wildcard)

### Servidor propio

Usar Let's Encrypt con certbot:

```bash
# Instalar certbot
sudo apt install certbot

# Generar certificado wildcard
sudo certbot certonly --manual --preferred-challenges dns \
  -d stapp.com.ar -d *.stapp.com.ar
```

---

## 5. Flujo de Autenticación

### Cómo funciona

1. Usuario accede a `guru-tech.stapp.com.ar`
2. Middleware detecta subdominio "guru-tech"
3. Si no está autenticado → Redirige a `/login`
4. Login muestra logo/nombre de "Guru Tech"
5. Al autenticarse, verifica que el usuario pertenezca a esa organización
6. Cookie se comparte entre subdominios gracias a `COOKIE_DOMAIN=.stapp.com.ar`

### Subdominios reservados (no disponibles para tenants)

```
www, api, app, admin, dashboard, mail, email, ftp, cdn, static,
assets, blog, help, support, status, docs, dev, staging, test,
login, registro, signup, signin
```

---

## 6. Crear Nueva Organización con Subdominio

Cuando un usuario se registra en `stapp.com.ar/registro`:

1. Ingresa nombre de organización
2. Sistema sugiere slug (ej: "Guru Tech" → "guru-tech")
3. Valida que el slug:
   - Tenga 3-50 caracteres
   - Empiece con letra
   - Solo letras minúsculas, números y guiones
   - No sea reservado
   - No exista en la base de datos
4. Crea organización con ese slug
5. Redirige a `guru-tech.stapp.com.ar/dashboard`

---

## 7. Probar en Desarrollo Local

### Paso 1: Editar archivo hosts

**Windows**: `C:\Windows\System32\drivers\etc\hosts` (como Administrador)

**Mac/Linux**: `/etc/hosts` (con sudo)

Agregar:
```
127.0.0.1 stapp.local
127.0.0.1 demo.stapp.local
127.0.0.1 guru-tech.stapp.local
127.0.0.1 mi-negocio.stapp.local
```

### Paso 2: Configurar .env.local

```env
NEXT_PUBLIC_ROOT_DOMAIN=stapp.local
# NO configurar COOKIE_DOMAIN en desarrollo
```

### Paso 3: Acceder

- `http://stapp.local:3000` → Landing
- `http://demo.stapp.local:3000` → Subdominio demo
- `http://guru-tech.stapp.local:3000` → Subdominio guru-tech

---

## 8. Troubleshooting

### "No tienes acceso a esta organización"

**Causa**: El usuario intentó acceder a un subdominio de una organización a la que no pertenece.

**Solución**: Verificar que el usuario esté registrado en esa organización.

### Cookies no se comparten entre subdominios

**Causa**: `COOKIE_DOMAIN` no está configurado o no tiene el punto inicial.

**Solución**:
```env
# Correcto (con punto)
COOKIE_DOMAIN=.stapp.com.ar

# Incorrecto (sin punto)
COOKIE_DOMAIN=stapp.com.ar
```

### Subdominio redirige al dominio principal

**Causa**: El subdominio está en la lista de reservados.

**Solución**: Usar otro nombre de subdominio.

### Error SSL en subdominio

**Causa**: Certificado wildcard no configurado.

**Solución**: En Vercel, agregar `*.stapp.com.ar` en Domains.

---

## 9. Archivos Relevantes

| Archivo | Descripción |
|---------|-------------|
| `middleware.ts` | Punto de entrada del middleware |
| `proxy.ts` | Lógica de extracción de subdominios |
| `lib/tenant.ts` | Funciones de validación de tenant |
| `lib/auth.ts` | Configuración de NextAuth con cookies |
| `app/(auth)/login/page.tsx` | Login con soporte para tenant |
| `app/api/auth/verify-tenant/route.ts` | API de verificación |

---

## 10. Checklist de Producción

- [ ] Dominio comprado y DNS configurado
- [ ] Registro wildcard (`*`) apuntando a Vercel/servidor
- [ ] Dominio agregado en Vercel (`stapp.com.ar` + `*.stapp.com.ar`)
- [ ] Variables de entorno configuradas:
  - [ ] `NEXT_PUBLIC_ROOT_DOMAIN`
  - [ ] `COOKIE_DOMAIN` (con punto inicial)
  - [ ] `NEXTAUTH_URL`
  - [ ] `NEXTAUTH_SECRET`
- [ ] SSL funcionando en subdominio de prueba
- [ ] Probar login en subdominio
- [ ] Verificar que cookies se comparten

---

## Contacto

Si tenés problemas con la configuración, revisá:
1. Los logs de Vercel/servidor
2. La consola del navegador (errores de CORS/cookies)
3. Network tab para ver si las cookies se envían correctamente
