# NaturalSpa Manager — Documento de diseño de solución

Plataforma web SaaS para la gestión integral del centro de estética y spa **NaturalSpa** (Santa Cruz de la Sierra, Bolivia): agenda, clientes, servicios, colaboradoras, horarios, reservas online, cobros, reportes, auditoría, usuarios y permisos.

## Índice

| # | Sección | Archivo |
|---|---|---|
| 1 | Resumen ejecutivo | [01-negocio.md](01-negocio.md#1-resumen-ejecutivo) |
| 2 | Análisis de negocio | [01-negocio.md](01-negocio.md#2-análisis-de-negocio) |
| 3 | Problemas detectados | [01-negocio.md](01-negocio.md#3-problemas-detectados) |
| 4 | Objetivos | [01-negocio.md](01-negocio.md#4-objetivos) |
| 5 | Requerimientos funcionales | [02-requerimientos.md](02-requerimientos.md) |
| 6 | Requerimientos no funcionales | [02-requerimientos.md](02-requerimientos.md#6-requerimientos-no-funcionales) |
| 7 | Arquitectura recomendada | [03-arquitectura-stack.md](03-arquitectura-stack.md) |
| 8 | Stack tecnológico recomendado | [03-arquitectura-stack.md](03-arquitectura-stack.md#8-stack-tecnológico-recomendado) |
| — | Estructura de carpetas | [03-arquitectura-stack.md](03-arquitectura-stack.md#estructura-de-carpetas-monorepo) |
| 9 | Diseño de base de datos + diagrama entidad-relación + DDL | [04-base-de-datos.md](04-base-de-datos.md) |
| — | Diseño de APIs | [05-api.md](05-api.md) |
| 10 | Módulos detallados | [06-modulos.md](06-modulos.md) |
| 11 | Roles y permisos (modelo de permisos) | [07-roles-permisos.md](07-roles-permisos.md) |
| 12 | Casos de uso | [08-casos-uso-historias.md](08-casos-uso-historias.md) |
| 13 | Historias de usuario | [08-casos-uso-historias.md](08-casos-uso-historias.md#13-historias-de-usuario) |
| 14 | Flujo de navegación | [09-ux-ui.md](09-ux-ui.md) |
| 15 | Wireframes en texto | [09-ux-ui.md](09-ux-ui.md#15-wireframes-en-texto) |
| 16 | Dashboard | [09-ux-ui.md](09-ux-ui.md#16-dashboard) |
| — | Diseño UX/UI y estrategia mobile | [09-ux-ui.md](09-ux-ui.md#diseño-uxui) |
| — | MVP detallado | [10-mvp-roadmap-plan.md](10-mvp-roadmap-plan.md) |
| 17 | Roadmap por fases | [10-mvp-roadmap-plan.md](10-mvp-roadmap-plan.md#17-roadmap-por-fases) |
| 18 | Plan de desarrollo | [10-mvp-roadmap-plan.md](10-mvp-roadmap-plan.md#18-plan-de-desarrollo) |
| 19 | Consideraciones de seguridad | [11-seguridad-auditoria.md](11-seguridad-auditoria.md) |
| 20 | Sistema de auditoría | [11-seguridad-auditoria.md](11-seguridad-auditoria.md#20-sistema-de-auditoría) |
| 21 | Escalabilidad futura | [12-escalabilidad-recomendaciones.md](12-escalabilidad-recomendaciones.md) |
| 22 | Recomendaciones finales | [12-escalabilidad-recomendaciones.md](12-escalabilidad-recomendaciones.md#22-recomendaciones-finales) |
| — | Operación: runbooks (despliegue, respaldos, incidentes) | [13-operacion-runbooks.md](13-operacion-runbooks.md) |

## Decisiones clave

- **Arquitectura:** monolito modular (NestJS) + Next.js + PostgreSQL + Redis/BullMQ, en un monorepo TypeScript.
- **Cero dobles reservas:** motor de disponibilidad + holds en Redis + restricción `EXCLUDE` en PostgreSQL.
- **Privacidad:** RBAC + alcance (propio/asignado/todo) + filtrado de campos. Las empleadas nunca reciben datos de contacto.
- **Trazabilidad:** soft delete en toda entidad de negocio + auditoría append-only (antes/después, usuario, fecha, hora, IP).
- **Móvil:** PWA mobile-first.
- **Futuro:** `organization_id` y `branch_id` desde el día 1 (multisede y SaaS).
- **Usuario de pruebas:** `admin@datly.local` / `Admin123*` (SUPER_ADMIN, activo), creado por seed; cambio obligatorio en producción.

## Pendiente de validar con el cliente

Ver las preguntas abiertas Q1–Q12 en [01-negocio.md §2.10](01-negocio.md#210-supuestos-y-preguntas-abiertas-para-validar-con-natalia). Las más importantes: número de cabinas, precios y duraciones reales, política de cancelación, composición del "Día de Novia" y qué datos de la clienta debe ver cada especialista.
