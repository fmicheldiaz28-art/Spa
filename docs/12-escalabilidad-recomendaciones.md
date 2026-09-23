# 21. Escalabilidad futura · 22. Recomendaciones finales

---

## 21. Escalabilidad futura (estrategia de escalabilidad)

### 21.1 Dimensiones de crecimiento

| Dimensión | Hoy | Escenario 3 años | Escenario SaaS (5 años) |
|---|---|---|---|
| Sedes | 1 | 2–3 | 200+ spas × 1–5 sedes |
| Colaboradoras | 5 | 15 | 3.000+ |
| Citas/año | ~7.000 | ~25.000 | ~5.000.000 |
| Clientas | ~2.000 | ~6.000 | ~1.000.000 |
| Usuarios concurrentes | < 10 | < 40 | ~2.000–5.000 |

**Conclusión:** para NaturalSpa (incluso con 3 sedes), **una sola instancia bien configurada sobra**. La estrategia está pensada para que el paso a SaaS no requiera reescribir.

### 21.2 Escalabilidad funcional: multisede (Fase 3)

Ya soportado en el modelo (`branch_id` en citas, horarios, colaboradoras, excepciones, feriados, cobros). Para activarlo:

1. Selector de sede en la topbar; filtros por sede en agenda, dashboard y reportes.
2. `user_roles.branch_id` para limitar el alcance (ej. RECEPCIÓN solo de la sede Equipetrol).
3. Colaboradoras que rotan entre sedes: horario semanal con `branch_id` por tramo (extensión de `work_schedules`).
4. Reportes consolidados y comparativos por sede.
5. Página de reservas con paso previo "Elige sede" (o una URL por sede).

### 21.3 Escalabilidad de negocio: SaaS multi-tenant

| Aspecto | Estrategia |
|---|---|
| Aislamiento | **Base de datos compartida, esquema compartido, `organization_id` en toda tabla** + **RLS por organización** (`app.org_id`) como garantía. Opción *premium*: base de datos dedicada para clientes grandes (misma aplicación, conexión por tenant) |
| Identificación del tenant | Subdominio (`naturalspa.datly.app`) o dominio propio; resolución en middleware → `organization_id` en el contexto |
| Configuración | `organizations.settings` + feature flags por plan (ej. `whatsapp_reminders`, `multisede`, `advanced_dashboard`) |
| Planes y facturación | Módulo `billing` con suscripciones (Stripe u otra pasarela disponible), límites por plan (colaboradoras, sedes, mensajes de WhatsApp) |
| Onboarding | Asistente: datos del negocio → servicios (plantillas por rubro) → equipo → horarios → link de reservas |
| Marca | Logo, colores y dominio personalizados en la página de reservas |
| Backoffice de plataforma | Panel SUPER_ADMIN: organizaciones, uso, soporte con **impersonación auditada** (con consentimiento del cliente) |
| Datos de referencia | Plantillas de servicios por rubro (spa, peluquería, barbería, uñas, estética) |

### 21.4 Escalabilidad técnica

| Capa | Hoy (MVP) | Crecimiento medio | Escala SaaS |
|---|---|---|---|
| **API** | 1 contenedor (2 vCPU) | 2–4 réplicas detrás de un load balancer (stateless) | Autoescalado horizontal (ECS/Kubernetes) por CPU o latencia |
| **WebSocket** | Mismo proceso | Proceso separado + adaptador Redis | Servicio dedicado o gestionado (Ably/Pusher) |
| **Workers** | 1 proceso | Colas separadas por prioridad | Workers autoescalados por longitud de cola |
| **PostgreSQL** | Instancia gestionada pequeña | Instancia mayor + **réplica de lectura** para reportes y dashboard | Particionado de `appointments` y `audit_logs` por tiempo; PgBouncer; sharding por `organization_id` (Citus) solo si hace falta |
| **Caché** | Redis (disponibilidad, permisos, KPIs) | Redis con réplica | Redis cluster; caché de catálogo público en el CDN |
| **Reportes** | Vistas materializadas | Réplica de lectura dedicada | Pipeline analítico (CDC con Debezium → ClickHouse/BigQuery) |
| **Estáticos** | CDN | CDN | CDN multi-región |
| **Búsqueda** | `pg_trgm` | `pg_trgm` | Meilisearch/OpenSearch si hace falta búsqueda difusa masiva |

### 21.5 Evolución de la arquitectura (extracción de módulos)

El monolito modular permite extraer servicios **solo cuando haya una razón concreta**:

| Candidato | Razón para extraer | Cuándo |
|---|---|---|
| `notifications` | Volumen alto de WhatsApp o email, proveedores múltiples, picos | > 100.000 mensajes/mes |
| `availability` | Cálculo intensivo con muchos tenants y consultas públicas | p95 > 400 ms con caché |
| `reports/analytics` | Consultas pesadas que afectan al transaccional | Cuando la réplica no alcance |
| `booking` público | Tráfico público muy superior al del backoffice | Escala SaaS |

Mecanismo: los eventos de dominio y el outbox ya existen → se sustituye el bus en memoria por un broker (SQS/SNS, RabbitMQ o NATS) sin cambiar los productores.

### 21.6 Integraciones futuras

| Integración | Fase | Diseño |
|---|---|---|
| **WhatsApp Business Cloud API** | F2 (plantillas), F3 (bot) | Adaptador `WhatsAppChannel` detrás de la interfaz `NotificationChannel`; webhooks con verificación de firma; plantillas aprobadas: `reminder_24h`, `booking_confirmed`, `booking_changed` |
| **Pagos QR / tarjeta** | F3 | Interfaz `PaymentProvider` (crear intención, webhook, reembolso); proveedores locales a evaluar según comisiones, API y liquidación. Anticipos como `payments.type = ANTICIPO` vinculados a la cita |
| **Facturación electrónica (SIN)** | F3 | Vía proveedor autorizado con API; emisión al registrar el cobro; almacenamiento del CUF y del PDF |
| **Google Calendar / iCal** | F2 | Feed iCal privado por especialista (solo sus citas, sin datos de contacto) |
| **Google Business Profile ("Reservar")** | F2 | Enlace a la página de reservas |
| **Instagram** | F2 | Botón "Reservar" en el perfil apuntando a la página pública |
| **Contabilidad** | F3 | Exportación contable (CSV) o integración con el software del contador |
| **Webhooks salientes (SaaS)** | F3 | `appointment.created`, etc., firmados con HMAC, para integraciones de clientes |

### 21.7 Observabilidad a escala

- Trazas distribuidas (OpenTelemetry) con `organization_id` como atributo.
- SLOs por tenant: disponibilidad 99,9 % y p95 < 300 ms.
- Paneles de negocio de la plataforma: citas por día, reservas online, mensajes enviados, errores por tenant.
- Presupuestos de error y alertas por burn rate.

---

## 22. Recomendaciones finales

### 22.1 Recomendaciones estratégicas

1. **Priorizar la confianza sobre las funcionalidades.** El éxito se medirá por que *ninguna cita vuelva a perderse* y *nadie vea lo que no debe*. Auditoría, soft delete, restricción `EXCLUDE` y alcance por rol son **no negociables** del MVP.
2. **Adelantar el trámite de WhatsApp Business en el Sprint 0.** Es la palanca más potente contra el no-show (10–20 %) y su aprobación es externa y lenta.
3. **Lanzar reservas online con una campaña interna:** link en la bio de Instagram, respuesta automática de WhatsApp Business ("Reserva 24/7 aquí: …"), QR en recepción. Meta: 25 % online a los 3 meses.
4. **Introducir anticipos de forma selectiva (F3):** primero para el Día de Novia y para clientas con ≥ 2 no-show, antes de generalizar. Así se reduce el ausentismo sin fricción para las clientas fieles.
5. **Usar los datos de ocupación** para promociones en horas valle (martes a jueves por la mañana) y para decidir contrataciones en sábado.
6. **Pensar en SaaS sin distraerse:** el diseño ya lo permite (`organization_id`, planes, marca), pero el MVP se optimiza para NaturalSpa. Validar primero con un cliente real y exitoso.

### 22.2 Recomendaciones operativas para Natalia

| Recomendación | Motivo |
|---|---|
| Definir por escrito la **política de cancelación** (12 h) y publicarla en la página de reservas y en WhatsApp | Respaldo ante reclamos; base de los anticipos |
| Registrar **alergias y contraindicaciones** de las clientas frecuentes en el primer mes | Seguridad y servicio personalizado |
| Registrar **todos los cobros** en el sistema (incluido el efectivo) | Sin esto, los KPIs de ventas no son reales |
| Firmar **acuerdos de confidencialidad** con el personal | Complementa la protección técnica de la base de clientes |
| Revisar la **auditoría semanalmente** los primeros 2 meses | Detectar malos usos y reforzar la cultura de registro |
| Cerrar la caja diariamente | Control de efectivo y QR |
| No compartir cuentas: **un usuario por persona** | Sin esto, la auditoría pierde valor |

### 22.3 Recomendaciones técnicas

1. **Tests del motor de disponibilidad y de la matriz de permisos desde el día 1**: son los dos componentes donde un error cuesta la confianza del cliente.
2. **ADRs** para cada decisión importante; el proyecto probablemente crecerá como SaaS y lo leerán otras personas.
3. **No optimizar prematuramente:** nada de microservicios, Kubernetes ni sharding en el MVP.
4. **Feature flags** desde el inicio (reservas online, recordatorios, anticipos) para activar gradualmente y hacer pruebas A/B más adelante.
5. **Trazabilidad end-to-end** con `request_id` en logs, auditoría y errores, para diagnosticar cualquier reclamo en minutos.
6. **Datos semilla realistas** en staging, para que Natalia pruebe con escenarios de su día a día.
7. **Revisión de seguridad externa** antes de abrir el SaaS a otros clientes.

### 22.4 Métricas de éxito post-lanzamiento (tablero del proyecto)

| Métrica | Línea base | Meta 3 meses | Meta 6 meses |
|---|---|---|---|
| Citas sin trazabilidad | Desconocido (> 0) | 0 | 0 |
| Dobles reservas | Ocasionales | 0 | 0 |
| % reservas online | 0 % | 25 % | 40 % |
| No-show | 10–20 % | < 12 % | < 8 % (con F2) |
| Tiempo semanal de Natalia en reportes | Horas | 0 | 0 |
| Mensajes de WhatsApp por disponibilidad y precios | 100 % manual | −40 % | −60 % |
| Adopción diaria por las especialistas | — | 5/5 | 5/5 |
| Satisfacción de Natalia (1–10) | — | ≥ 8 | ≥ 9 |

### 22.5 Próximos pasos inmediatos

1. **Validar este documento con Natalia** (sesión de 90 min) y resolver las preguntas abiertas Q1–Q12 (§2.10).
2. Obtener los datos reales: lista de precios, duraciones, horarios de cada colaboradora y exportación de las hojas actuales.
3. Aprobar el stack, el presupuesto y el equipo.
4. Iniciar el Sprint 0: repositorio, entornos, seed con `admin@datly.local`, design system y trámite de WhatsApp Business.
5. Agendar las reviews quincenales con Natalia (demos en staging).

---

> **Resumen en una frase:** NaturalSpa Manager convierte una operación frágil basada en Sheets y WhatsApp en una plataforma confiable (auditoría inmutable, cero dobles reservas), privada (cada empleada ve solo lo suyo y nadie se lleva la base de clientes) y autónoma (reservas 24/7 y reportes automáticos), con una arquitectura preparada para crecer a multisede y a un producto SaaS.
