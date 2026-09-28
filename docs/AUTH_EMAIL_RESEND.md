# Correo de Auth en producción (Resend)

Fecha: 2026-09-27. Estado: **preparado, pendiente de credenciales** (dominio + API key).

## Por qué

El correo integrado de Supabase es solo para desarrollo: **2 correos por hora**, sin
garantía de entrega a cualquier destinatario y sin plantillas personalizables en el plan
Free. Registro y "olvidé mi contraseña" dependen de él. Para beta pública hace falta un
SMTP propio; Resend tiene plan gratuito (3 000 correos/mes, 100/día) y SMTP directo.

## Qué está listo en el repo

- `scripts/production-canary/configure_auth_smtp.py` — configura Supabase Auth vía
  Management API: `smtp.resend.com:465`, usuario `resend`, contraseña = API key,
  remitente y nombre, límite horario 200, y plantillas HTML con la marca Pianissimo
  (confirmación, recuperación, magic link, cambio de correo). `--check` muestra el estado
  sin secretos; `--revert` vuelve al correo integrado.
- El frontend ya no depende del proveedor: usa enlaces de confirmación/recuperación
  (`emailRedirectTo` = origen del sitio) que funcionan igual con cualquier SMTP.

## Lo que falta (humano, ~15 min)

1. **Un dominio propio.** Resend no envía desde `*.vercel.app`. Registrar p. ej.
   `pianissimo.app` (o usar uno existente) y, en Resend → Domains, publicar los registros
   DNS (SPF, DKIM, opcional DMARC). Este dominio será también el del sitio en Vercel.
2. **API key de Resend** con permiso de envío.
3. **Token personal de Supabase** (`sbp_…`, Account → Access Tokens) — el anterior fue
   revocado a propósito; se genera uno nuevo y se revoca al terminar.
4. En `.env.local`:
   ```ini
   SUPABASE_ACCESS_TOKEN=sbp_...
   RESEND_API_KEY=re_...
   AUTH_SENDER_EMAIL=hola@pianissimo.app
   AUTH_SENDER_NAME=Pianissimo
   ```
5. `python scripts/production-canary/configure_auth_smtp.py --apply` y luego probar
   "Crear cuenta" con un correo externo (Gmail) y "Olvidé mi contraseña".

## Mientras tanto

Las cuentas se crean a mano con `scripts/create_user.py correo contraseña` (quedan
confirmadas, sin correo). Si un usuario existente olvida su contraseña, el mismo script
la restablece.
