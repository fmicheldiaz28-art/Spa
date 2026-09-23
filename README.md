# NaturalSpa Manager

Plataforma web para gestionar agenda, clientas, servicios, colaboradoras, reservas online, cobros, reportes y auditoría de **NaturalSpa** (Santa Cruz de la Sierra, Bolivia).

El documento de diseño completo está en [docs/](docs/README.md).

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
| Recordatorios por WhatsApp/email, MFA, RLS, cola de trabajos con Redis | ⏳ Fase 2 | docs/10 §17 |

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
- **Pendiente de verificar con PostgreSQL real:** la prueba de concurrencia (10 reservas simultáneas del mismo horario) se ejecutó sobre PGlite. La base respondió bien (una sola cita creada), pero PGlite se desincroniza con transacciones concurrentes que fallan. Hay que repetirla con Docker o `db:start`.
- **JWT firmado con HS256** en esta etapa; el paso a EdDSA con rotación de claves (docs §19.2) está previsto para el hardening del Sprint 6.
