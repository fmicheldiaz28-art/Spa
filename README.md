# NaturalSpa Manager

Plataforma web para gestionar agenda, clientas, servicios, colaboradoras, reservas online, cobros, reportes y auditoría de **NaturalSpa** (Santa Cruz de la Sierra, Bolivia).

El documento de diseño completo está en [docs/](docs/README.md). Operación en producción: [docs/13-operacion-runbooks.md](docs/13-operacion-runbooks.md).

## Estructura

```
apps/api        API REST (NestJS 12 + Prisma 7 + PostgreSQL)
apps/web        Web (Next.js 16 + Tailwind 4): backoffice, reservas y portal
packages/shared Catálogo de permisos, matriz de roles y enums compartidos
infra/          Docker Compose y scripts de desarrollo
docs/           Documento de diseño de la solución
```

## Requisitos

- Node.js 22+ (probado con 24)
- pnpm vía Corepack: `corepack enable pnpm` (la versión la fija `package.json`)
- PostgreSQL 17+ con una de estas opciones:

| Opción | Comando | Notas |
|---|---|---|
| **Docker** (recomendada) | `docker compose -f infra/docker/docker-compose.yml up -d` | PostgreSQL 18, Redis y Mailpit; igual que producción |
| **PostgreSQL embebido** | `pnpm db:start` | Binarios reales en `.data/postgres`. En Windows requiere el *Microsoft Visual C++ Redistributable 2015+ (x64)* |
| **PGlite** (sin instalar nada) | `pnpm db:start:lite` | PostgreSQL compilado a WebAssembly en `.data/pglite`. Usa `DATABASE_POOL_MAX=1` y la URL indicada en `.env.example`. Solo para desarrollo |

## Puesta en marcha

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # genera un JWT_SECRET propio
pnpm db:start                            # en otra terminal (o Docker / db:start:lite)
pnpm db:migrate
pnpm db:seed
pnpm dev                                 # API en :4000 y web en :3000
```

Abre http://localhost:3000.

## Usuarios

| Usuario | Contraseña | Rol | Entorno |
|---|---|---|---|
| `admin@datly.local` (Super Admin) | `Admin123*` | SUPER_ADMIN | Todos. En producción obliga a cambiar la contraseña al ingresar |
| `natalia@naturalspa.local` | `Demo123*` | ADMIN | Solo con `SEED_DEMO=true` (local/staging) |
| `andrea@`, `lucia@`, `katherine@`, `unas1@`, `unas2@naturalspa.local` | `Demo123*` | EMPLEADA | Solo con `SEED_DEMO=true` |

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | API y web en modo desarrollo |
| `pnpm build` | Compila todo |
| `pnpm test` | Pruebas unitarias |
| `pnpm db:migrate` | Aplica migraciones pendientes |
| `pnpm db:seed` | Seed idempotente (permisos, roles, Super Admin, catálogo, demo) |
| `pnpm db:reset` | Borra la base de datos, migra y ejecuta el seed |

## Estado del MVP (Fase 1)

| Módulo | Estado | Dónde |
|---|---|---|
| Login, recuperación y cambio de contraseña, bloqueo por intentos, límite de peticiones | ✅ | `/login`, `/recuperar` |
| Usuarios (alta con contraseña temporal, roles, desactivar, desbloquear, cerrar sesiones) | ✅ | `/app/usuarios` |
| Auditoría inmutable con filtros y diff antes/después | ✅ | `/app/auditoria` |
| Clientes con privacidad por rol, contacto enmascarado y revelación auditada, importación CSV | ✅ | `/app/clientes` |
| Servicios, categorías y paquetes (secuencia y paralelo) | ✅ | `/app/servicios`, `/app/paquetes` |
| Colaboradoras, horario semanal con vigencia, ausencias, solicitudes, feriados, horario del negocio | ✅ | `/app/colaboradoras`, `/app/horarios` |
| Agenda día/semana/mes/lista, crear, reagendar (arrastrar y soltar), estados, cancelar, eliminar y restaurar, historial | ✅ | `/app/agenda`, `/app/mi-dia` |
| Actualización en tiempo real de la agenda (Server-Sent Events, filtrada por colaboradora) | ✅ | `GET /api/v1/events` |
| Cobros (pago dividido, anulación) y cierre de caja | ✅ | `/app/cobros` |
| Dashboard con 7 KPIs y 4 gráficas | ✅ | `/app/dashboard` |
| Reportes (ventas, servicios, clientes, personal, cancelaciones) y exportación a Excel | ✅ | `/app/reportes` |
| Reservas online 24/7, verificación por código, gestión por enlace, "Mis reservas" | ✅ | `/reservar`, `/mi-cuenta` |
| Configuración del negocio y políticas | ✅ | `/app/configuracion` |
| Recordatorios por email (24 h y 2 h, configurables) con confirmación de asistencia, reagendar o cancelar en un clic; adjunto .ics en la confirmación | ✅ (adelantado de Fase 2; se activa en Configuración) | `/app/configuracion` |
| Aviso de clientas con no-show repetido (umbral configurable) en agenda y ficha de la cita | ✅ | `/app/agenda`, `/app/configuracion` |
| App instalable (PWA: manifest, íconos, service worker con página sin conexión) | ✅ (el service worker se activa solo en producción) | — |
| Cabeceras de seguridad en la web (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy) | ✅ | `apps/web/next.config.ts` |
| Reporte semanal por email a administración (lunes, con el último sello de auditoría) | ✅ (adelantado de Fase 2) | `/app/configuracion` |
| Auditoría con hash encadenado, verificación de integridad y comparación con el sello del reporte semanal | ✅ (adelantado de Fase 2) | `/app/auditoria` → Verificar integridad |
| Verificación en dos pasos (TOTP + códigos de recuperación), obligatoria para administración si se activa la política; reinicio por celular perdido | ✅ (adelantado de Fase 2) | `/seguridad`, `/app/usuarios` |
| Lista de espera: la clienta se anota online (o la anota administración) y recibe un email cuando se libera un horario compatible; "Mis esperas" y "Reservar de nuevo" en el portal | ✅ (adelantado de Fase 2) | `/reservar`, `/mi-cuenta`, `/app/lista-espera` |
| Recordatorio y aviso de lista de espera por WhatsApp en un clic (enlace wa.me con el mensaje escrito; el teléfono no se muestra y cada uso queda auditado) | ✅ | Ficha de la cita, `/app/lista-espera` |
| Notificaciones push (PWA): a las especialistas cuando les asignan, mueven o cancelan una cita; a administración cuando una clienta reserva, reagenda o cancela online | ✅ (requiere claves VAPID: `pnpm --filter @naturalspa/api push:keys`) | Mi día, `/seguridad` |
| Recordatorios automáticos por WhatsApp (API de WhatsApp Business), RLS, Redis | ⏳ Fase 2 (WhatsApp requiere plantilla aprobada por Meta) | docs/10 §17 |

**Diferencia con el documento de diseño:** las clientas no usan contraseña. Se identifican con un código enviado a su email y gestionan su reserva con el enlace privado del email de confirmación. Es menos fricción para ellas y evita guardar contraseñas débiles.

**Correo en desarrollo:** sin `SMTP_URL`, los emails (códigos, confirmaciones, recuperación) se escriben en el log del API.

## Decisiones técnicas del Sprint 0

- **Migraciones en SQL escrito a mano** (`apps/api/prisma/migrations`): incluyen la restricción `EXCLUDE` anti doble reserva, los triggers que hacen inmutable la auditoría, las particiones mensuales de `audit_logs` y las vistas de reportes, que Prisma no modela. `schema.prisma` se mantiene alineado y solo se usa para generar el cliente tipado. Para un cambio de esquema: editar `schema.prisma`, generar el borrador con `prisma migrate diff`, completarlo a mano y aplicarlo con `db:migrate`.
- **Autorización deny-by-default:** todo endpoint debe declarar `@Public()`, `@Authenticated()` o `@RequirePermission(...)`; si no, responde 403.
- **Sesiones:** access token JWT de 15 min en memoria + refresh token opaco rotativo en cookie `httpOnly`. La reutilización de un refresh token ya rotado revoca toda la familia de sesiones.
- **Argon2id en WebAssembly** (`hash-wasm`, m = 64 MiB, t = 3, p = 1): sin binarios nativos, idéntico en Windows, Linux y CI.
- **Fechas siempre en UTC:** el adaptador de Prisma para PostgreSQL envía y lee `timestamptz` sin desplazamiento horario, así que cada conexión fuerza `TimeZone=UTC` y una migración fija UTC en la base. La hora de La Paz se muestra en la aplicación.
- **Doble reserva imposible en tres capas:** motor de disponibilidad (función pura con pruebas), retención de 10 min del horario en reservas online y restricción `EXCLUDE` en PostgreSQL. Las retenciones y la idempotencia viven en memoria (una instancia); al escalar pasan a Redis con la misma interfaz.
- **Tiempo real con Server-Sent Events** (alternativa prevista en docs §8) en lugar de Socket.IO: sin dependencias nuevas y suficiente porque el flujo es solo servidor → navegador. Los eventos llevan únicamente identificadores; cada pantalla vuelve a pedir los datos con sus permisos. El stream se cierra al vencer el access token y el cliente se reconecta. Bus en memoria (una instancia); al escalar, Redis pub/sub.
- **Recordatorios sin Redis:** la tabla `notifications` hace de cola. Un proceso del API (cada `REMINDERS_INTERVAL_SEC`, 60 s) programa una fila por cita, aviso y horario (índice único → idempotente aunque haya varias instancias) y la envía revalidando que la cita siga activa y en el mismo horario; reagendar genera avisos nuevos y borra la confirmación anterior. El enlace del email es un JWT firmado que vale solo para esa cita y vence al terminar.
- **Web Push sin dependencias:** cifrado RFC 8291 (aes128gcm) y firma VAPID RFC 8292 con `node:crypto` y `jose`; la prueba reproduce byte por byte el vector oficial del RFC. Qué avisar se deduce del último registro de auditoría de la cita, sin tocar los módulos que la modifican, y nunca se avisa a quien hizo el cambio.
- **PWA sin datos en caché:** el service worker solo guarda archivos estáticos con hash y la página sin conexión; nunca respuestas del API ni páginas con datos de clientas.
- **Auditoría con hash encadenado:** cada registro se sella en PostgreSQL (`seal_audit_logs()`, cada minuto) con `SHA-256(prev_hash ‖ registro)`; el trigger de inmutabilidad solo permite escribir el sello una vez. `verify_audit_chain()` detecta registros alterados, borrados o reordenados aunque se salten los triggers. El reporte semanal lleva el último sello a la bandeja de administración como ancla externa.
- **MFA sin dependencias en el API:** TOTP (RFC 6238) con `node:crypto`, probado con los vectores del RFC; secreto cifrado con AES-256-GCM (`MFA_ENCRYPTION_KEY`); protección contra repetición del mismo código; códigos de recuperación guardados como hash.
- **Concurrencia verificada en CI sobre PostgreSQL real:** `apps/api/scripts/smoke.mjs` lanza 10 reservas simultáneas del mismo horario y exige exactamente 1 creada y 9 rechazadas con 409; también comprueba el sellado de la auditoría y el login con MFA. PGlite (desarrollo) no soporta transacciones concurrentes: localmente se usa `SMOKE_SKIP_CONCURRENCY=1`.
- **JWT firmado con HS256** en esta etapa; el paso a EdDSA con rotación de claves (docs §19.2) está previsto para el hardening del Sprint 6.
