# 5–6. Requerimientos

**Convenciones de prioridad (MoSCoW):** **M** = Must (imprescindible), **S** = Should (importante), **C** = Could (deseable), **W** = Won't now (futuro).
**Fase:** F1 = MVP · F2 = Retención · F3 = Monetización y escala.

---

## 5. Requerimientos funcionales

### 5.1 Autenticación y seguridad (AUTH)

| ID | Requerimiento | Prioridad | Fase |
|---|---|---|---|
| RF-AUTH-01 | El usuario inicia sesión con email y contraseña. | M | F1 |
| RF-AUTH-02 | El usuario cierra sesión; la sesión (refresh token) se revoca en el servidor. | M | F1 |
| RF-AUTH-03 | El usuario solicita recuperar su contraseña por email mediante un enlace de un solo uso válido 30 minutos. | M | F1 |
| RF-AUTH-04 | El usuario autenticado cambia su contraseña indicando la actual. | M | F1 |
| RF-AUTH-05 | El sistema obliga a cambiar la contraseña en el primer inicio de sesión cuando el usuario fue creado por un administrador (`must_change_password`). | M | F1 |
| RF-AUTH-06 | La cuenta se bloquea temporalmente (15 min) tras 5 intentos fallidos consecutivos. | M | F1 |
| RF-AUTH-07 | Existen los roles SUPER_ADMIN, ADMIN, EMPLEADA y CLIENTE, cada uno con permisos granulares. | M | F1 |
| RF-AUTH-08 | El SUPER_ADMIN puede crear roles personalizados y asignarles permisos. | S | F1 |
| RF-AUTH-09 | El administrador ve las sesiones activas de un usuario y puede cerrarlas remotamente. | S | F1 |
| RF-AUTH-10 | Autenticación en dos pasos (TOTP) opcional para SUPER_ADMIN y ADMIN. | S | F2 |
| RF-AUTH-11 | Desde la primera versión existe el usuario de pruebas **Super Admin** (`admin@datly.local` / `Admin123*`, rol SUPER_ADMIN, activo), creado por *seed*. | M | F1 |
| RF-AUTH-12 | La sesión expira por inactividad (configurable; por defecto 8 h para personal y 30 días para clientes con "recordarme"). | M | F1 |

### 5.2 Dashboard ejecutivo (DASH)

| ID | Requerimiento | Prioridad | Fase |
|---|---|---|---|
| RF-DASH-01 | KPI **Ventas del día** (suma de cobros confirmados del día, en Bs). | M | F1 |
| RF-DASH-02 | KPI **Ventas del mes** con comparación contra el mes anterior al mismo día (%). | M | F1 |
| RF-DASH-03 | KPI **Citas del día**, desglosadas por estado. | M | F1 |
| RF-DASH-04 | KPI **Ocupación** (% de minutos reservados sobre minutos disponibles) del día y de la semana. | M | F1 |
| RF-DASH-05 | KPI **Cancelaciones** (cantidad y % del periodo). | M | F1 |
| RF-DASH-06 | KPI **No-show** (cantidad y % del periodo). | M | F1 |
| RF-DASH-07 | KPI **Reservas online** (cantidad y % del total del periodo). | M | F1 |
| RF-DASH-08 | Gráfica de **ventas** (línea/área por día, últimos 30 días; comparación con el periodo anterior). | M | F1 |
| RF-DASH-09 | Gráfica de **servicios más vendidos** (barras horizontales, top 10 por cantidad e ingreso). | M | F1 |
| RF-DASH-10 | Gráfica de **ocupación por colaboradora** (barras). | M | F1 |
| RF-DASH-11 | Gráfica de **nuevos clientes** (columnas por semana o mes). | M | F1 |
| RF-DASH-12 | Filtro de periodo: hoy, 7 días, mes actual, mes anterior, rango personalizado. | M | F1 |
| RF-DASH-13 | La EMPLEADA ve un dashboard personal ("Mi día"): sus citas de hoy, próxima cita y su ocupación. **Sin montos globales ni datos de otras.** | M | F1 |
| RF-DASH-14 | Panel "Próximas citas de hoy" con acceso rápido a cada cita. | S | F1 |
| RF-DASH-15 | Dashboard avanzado: cohortes, retención, ticket promedio, heatmap de ocupación por hora. | C | F3 |

### 5.3 Usuarios (USR)

| ID | Requerimiento | Prioridad | Fase |
|---|---|---|---|
| RF-USR-01 | CRUD de usuarios del personal: nombre, email, teléfono, rol, estado, foto. | M | F1 |
| RF-USR-02 | Al crear una EMPLEADA se crea su perfil de colaboradora (color de agenda, servicios que realiza, horario). | M | F1 |
| RF-USR-03 | Los usuarios se **desactivan**, no se eliminan. Desactivar revoca todas las sesiones de inmediato. | M | F1 |
| RF-USR-04 | El administrador puede forzar el restablecimiento de contraseña de un usuario. | M | F1 |
| RF-USR-05 | Listado con búsqueda, filtro por rol y estado, y paginación. | M | F1 |
| RF-USR-06 | Un ADMIN no puede crear, editar ni desactivar a un SUPER_ADMIN. | M | F1 |
| RF-USR-07 | No se puede desactivar al último SUPER_ADMIN activo. | M | F1 |

### 5.4 Clientes (CLI)

| ID | Requerimiento | Prioridad | Fase |
|---|---|---|---|
| RF-CLI-01 | Ficha de cliente: nombre, apellido, teléfono, email, fecha de nacimiento, género (opcional), observaciones, preferencias, alergias y contraindicaciones, origen, estado. | M | F1 |
| RF-CLI-02 | Historial de citas del cliente con servicios, colaboradora, estado y monto. | M | F1 |
| RF-CLI-03 | Validación de duplicados por teléfono normalizado (E.164, +591) y email. | M | F1 |
| RF-CLI-04 | Búsqueda por nombre, teléfono o email (solo ADMIN o permiso `clients.read_all`). | M | F1 |
| RF-CLI-05 | La EMPLEADA solo accede a clientes con citas **asignadas a ella** (futuras o de los últimos 12 meses, configurable) y **sin datos de contacto**. | M | F1 |
| RF-CLI-06 | Teléfono y email enmascarados por defecto incluso para ADMIN; revelarlos requiere un clic y queda auditado. | S | F1 |
| RF-CLI-07 | Alerta visible de alergias y contraindicaciones en la cita y en la ficha. | M | F1 |
| RF-CLI-08 | Registro de consentimiento de privacidad y de comunicaciones (fecha, canal, versión de la política). | M | F1 |
| RF-CLI-09 | Fusión de clientes duplicados (solo ADMIN, auditado). | S | F1 |
| RF-CLI-10 | Importación inicial desde Google Sheets (CSV) con reporte de errores y duplicados. | M | F1 |
| RF-CLI-11 | Exportación de clientes (solo ADMIN, auditada, con motivo obligatorio). | S | F1 |
| RF-CLI-12 | Etiquetas de cliente (VIP, novia, frecuente, etc.). | C | F2 |
| RF-CLI-13 | Anonimización del cliente a solicitud (derecho al olvido), conservando las métricas agregadas. | S | F2 |

### 5.5 Servicios (SRV)

| ID | Requerimiento | Prioridad | Fase |
|---|---|---|---|
| RF-SRV-01 | CRUD de servicios: nombre, descripción, duración (min), precio (Bs), categoría, estado (activo/inactivo). | M | F1 |
| RF-SRV-02 | CRUD de categorías de servicio (Masajes, Facial, Depilación, Uñas, Corporal). | M | F1 |
| RF-SRV-03 | Tiempo de preparación o limpieza posterior (`buffer_after_min`). | M | F1 |
| RF-SRV-04 | Asignación de qué colaboradoras pueden realizar cada servicio. | M | F1 |
| RF-SRV-05 | Indicador "visible en reservas online" por servicio. | M | F1 |
| RF-SRV-06 | Precio o duración específicos por colaboradora (override). | C | F2 |
| RF-SRV-07 | Los cambios de precio **no alteran** citas ya creadas (el precio se congela en la cita). | M | F1 |
| RF-SRV-08 | Imagen del servicio para la página de reservas. | S | F1 |

### 5.6 Paquetes (PAQ)

| ID | Requerimiento | Prioridad | Fase |
|---|---|---|---|
| RF-PAQ-01 | CRUD de paquetes: nombre, descripción, precio total, estado, visible online. | M | F1 |
| RF-PAQ-02 | Un paquete contiene servicios **ordenados**, con opción de que se hagan en secuencia o en paralelo (ej. mani y pedi simultáneos con dos especialistas). | M | F1 |
| RF-PAQ-03 | Al agendar un paquete se crea **una cita con varios ítems**, cada uno con su colaboradora y su horario. | M | F1 |
| RF-PAQ-04 | La duración total se calcula a partir de los ítems. | M | F1 |
| RF-PAQ-05 | Paquetes prepagados o bonos de sesiones (ej. 10 drenajes). | W | F3 |

### 5.7 Agenda (AGE)

| ID | Requerimiento | Prioridad | Fase |
|---|---|---|---|
| RF-AGE-01 | Vista **Día** con columnas por colaboradora (ADMIN) o columna única (EMPLEADA). | M | F1 |
| RF-AGE-02 | Vista **Semana** y vista **Mes**. | M | F1 |
| RF-AGE-03 | Crear cita: cliente (buscar o crear rápido), servicio o paquete, colaboradora, fecha y hora, notas. | M | F1 |
| RF-AGE-04 | Editar cita (notas, servicio, colaboradora), validando disponibilidad. | M | F1 |
| RF-AGE-05 | **Reagendar** (arrastrar y soltar en escritorio, o formulario), validando disponibilidad. | M | F1 |
| RF-AGE-06 | **Cancelar** cita con motivo obligatorio y quién canceló (cliente o spa). | M | F1 |
| RF-AGE-07 | Estados de la cita: PENDIENTE → CONFIRMADA → EN_CURSO → COMPLETADA, más CANCELADA y NO_SHOW. | M | F1 |
| RF-AGE-08 | **Imposible** agendar dos citas solapadas para la misma colaboradora (validación en la app **y** restricción en la base de datos). | M | F1 |
| RF-AGE-09 | No se puede agendar fuera del horario laboral de la colaboradora, en vacaciones, permisos, bloqueos o feriados. ADMIN puede forzarlo con justificación auditada (sobre-turno). | M | F1 |
| RF-AGE-10 | Las citas **nunca se eliminan físicamente**; "eliminar" = soft delete con motivo, solo ADMIN. | M | F1 |
| RF-AGE-11 | Historial de cambios visible en el detalle de la cita (línea de tiempo). | M | F1 |
| RF-AGE-12 | Filtros por colaboradora, estado y servicio. | M | F1 |
| RF-AGE-13 | Colores por colaboradora e iconos por estado. | M | F1 |
| RF-AGE-14 | Control de concurrencia: si dos personas editan la misma cita, la segunda recibe un aviso de conflicto (bloqueo optimista). | M | F1 |
| RF-AGE-15 | La EMPLEADA puede marcar sus citas como EN_CURSO, COMPLETADA o NO_SHOW; no puede crearlas, moverlas ni cancelarlas (configurable). | M | F1 |
| RF-AGE-16 | Actualización en tiempo real de la agenda (si Natalia mueve una cita, la especialista lo ve sin recargar). | S | F1 |
| RF-AGE-17 | Cita "walk-in" (clienta sin reserva) en 3 clics. | S | F1 |
| RF-AGE-18 | Lista de espera para horarios llenos. | C | F2 |

### 5.8 Horarios (HOR)

| ID | Requerimiento | Prioridad | Fase |
|---|---|---|---|
| RF-HOR-01 | Horario general del negocio por día de la semana (mar–sáb 09:00–19:00). | M | F1 |
| RF-HOR-02 | Horario laboral semanal por colaboradora, con varios tramos por día (ej. 09–13 y 14–19) y vigencia desde/hasta. | M | F1 |
| RF-HOR-03 | Registro de **vacaciones** (rango de fechas). | M | F1 |
| RF-HOR-04 | Registro de **permisos** (día completo o por horas). | M | F1 |
| RF-HOR-05 | **Festivos** del negocio (cierre total o parcial). | M | F1 |
| RF-HOR-06 | **Bloqueos** puntuales (reunión, capacitación, almuerzo). | M | F1 |
| RF-HOR-07 | Al crear una ausencia que choca con citas existentes, el sistema lista las citas afectadas y ofrece reagendarlas. | M | F1 |
| RF-HOR-08 | La EMPLEADA ve su horario y puede **solicitar** vacaciones o permisos; ADMIN los aprueba o rechaza. | S | F1 |
| RF-HOR-09 | Horario de almuerzo recurrente. | S | F1 |

### 5.9 Reservas online (RES)

| ID | Requerimiento | Prioridad | Fase |
|---|---|---|---|
| RF-RES-01 | Página pública de reservas (`/reservar`) accesible sin iniciar sesión hasta el paso de confirmación. | M | F1 |
| RF-RES-02 | Flujo: servicio o paquete → colaboradora (o "Cualquiera disponible") → fecha → hora → datos / login → confirmar. | M | F1 |
| RF-RES-03 | Solo se muestran horarios **realmente disponibles** (motor de disponibilidad). | M | F1 |
| RF-RES-04 | El horario elegido se **reserva temporalmente** 10 minutos mientras la clienta completa sus datos. | M | F1 |
| RF-RES-05 | Registro de cliente (nombre, teléfono, email, contraseña, consentimiento) o login. | M | F1 |
| RF-RES-06 | Email de confirmación con resumen, enlace para agregar al calendario (.ics) y enlace para gestionar la reserva. | M | F1 |
| RF-RES-07 | Reglas configurables: anticipación mínima (2 h) y máxima (60 días), máximo de reservas activas por cliente (3). | M | F1 |
| RF-RES-08 | Estado inicial configurable: CONFIRMADA automáticamente (defecto) o PENDIENTE de aprobación. | S | F1 |
| RF-RES-09 | "Mis reservas": ver, reagendar y cancelar respetando la política de cancelación. | M | F1 |
| RF-RES-10 | Protección anti-abuso: rate limiting y verificación de email o teléfono (OTP) antes de la primera reserva. | S | F1 |
| RF-RES-11 | Notificación interna a ADMIN por cada reserva online nueva. | M | F1 |
| RF-RES-12 | La página de reservas no muestra nombres completos de otras clientas ni datos internos. | M | F1 |

### 5.10 Cobros (PAY) — *necesario para los KPIs de ventas*

| ID | Requerimiento | Prioridad | Fase |
|---|---|---|---|
| RF-PAY-01 | Registrar el cobro de una cita: monto, método (efectivo, QR, transferencia, tarjeta), referencia y descuento. | M | F1 |
| RF-PAY-02 | Pagos parciales y múltiples métodos por cita. | S | F1 |
| RF-PAY-03 | Anular un cobro (solo ADMIN, con motivo y auditado); no se edita. | M | F1 |
| RF-PAY-04 | Cierre de caja diario (resumen por método). | S | F1 |
| RF-PAY-05 | Anticipos o depósitos requeridos para reservar ciertos servicios. | W | F3 |
| RF-PAY-06 | Pago online con QR interoperable o tarjeta. | W | F3 |

### 5.11 Reportes (REP)

| ID | Requerimiento | Prioridad | Fase |
|---|---|---|---|
| RF-REP-01 | Reporte de **ventas**: por día, semana o mes, método de pago, servicio y colaboradora. | M | F1 |
| RF-REP-02 | Reporte de **servicios**: cantidad, ingreso, duración total, ranking. | M | F1 |
| RF-REP-03 | Reporte de **clientes**: nuevos, recurrentes, inactivos (> 90 días sin visita), top clientes por gasto. | M | F1 |
| RF-REP-04 | Reporte de **personal**: citas atendidas, ocupación, cancelaciones, no-show e ingresos por colaboradora. | M | F1 |
| RF-REP-05 | Reporte de **cancelaciones y no-show** con motivos. | M | F1 |
| RF-REP-06 | Exportar a Excel (XLSX) y PDF, solo ADMIN y auditado. | M | F1 |
| RF-REP-07 | Filtros por rango de fechas, colaboradora, servicio y categoría. | M | F1 |
| RF-REP-08 | La EMPLEADA solo puede ver su reporte personal (sus citas atendidas del mes). | S | F1 |
| RF-REP-09 | Envío programado de reportes por email (semanal a Natalia). | C | F2 |

### 5.12 Auditoría (AUD)

| ID | Requerimiento | Prioridad | Fase |
|---|---|---|---|
| RF-AUD-01 | Registrar **toda** creación, modificación, cancelación, eliminación lógica, restauración, login, logout, login fallido, cambio de contraseña, exportación y revelación de datos sensibles. | M | F1 |
| RF-AUD-02 | Cada registro guarda: usuario, rol, acción, módulo, entidad, id de entidad, **fecha y hora**, **valor anterior**, **valor nuevo**, campos cambiados, IP, dispositivo e id de petición. | M | F1 |
| RF-AUD-03 | Los registros de auditoría son **inmutables** (no se pueden editar ni borrar, ni siquiera por SUPER_ADMIN desde la app; protegidos en la base de datos). | M | F1 |
| RF-AUD-04 | Pantalla de auditoría con filtros por usuario, módulo, acción, entidad y rango de fechas. | M | F1 |
| RF-AUD-05 | Vista "diff" que muestra el antes y el después campo por campo. | M | F1 |
| RF-AUD-06 | Desde cualquier cita, acceso directo a su historial de auditoría. | M | F1 |
| RF-AUD-07 | Retención mínima de 5 años (configurable). | S | F1 |
| RF-AUD-08 | Encadenamiento por hash para detectar manipulación directa en la base de datos. | S | F2 |

### 5.13 Notificaciones (NOT)

| ID | Requerimiento | Prioridad | Fase |
|---|---|---|---|
| RF-NOT-01 | Email transaccional: confirmación de reserva, cambio, cancelación y recuperación de contraseña. | M | F1 |
| RF-NOT-02 | Notificaciones internas (campana) para ADMIN: nueva reserva online, cancelación de cliente, solicitud de vacaciones. | S | F1 |
| RF-NOT-03 | Recordatorio automático 24 h antes con botones "Confirmar" / "Reagendar" / "Cancelar". | M | F2 |
| RF-NOT-04 | Recordatorio 2 h antes. | S | F2 |
| RF-NOT-05 | Envío por WhatsApp con plantillas aprobadas (WhatsApp Business Cloud API). | M | F2 |
| RF-NOT-06 | Conversación bidireccional por WhatsApp (bot de reservas y respuestas). | C | F3 |
| RF-NOT-07 | Plantillas editables por ADMIN. | S | F2 |

### 5.14 Configuración (CFG)

| ID | Requerimiento | Prioridad | Fase |
|---|---|---|---|
| RF-CFG-01 | Datos del negocio: nombre, logo, dirección, teléfono, redes, zona horaria, moneda. | M | F1 |
| RF-CFG-02 | Políticas: ventana de cancelación, anticipación de reserva, intervalo de horarios (15 min), autoconfirmación. | M | F1 |
| RF-CFG-03 | Visibilidad de clientes para empleadas (meses hacia atrás). | S | F1 |
| RF-CFG-04 | Personalización de la página de reservas (colores, portada, textos). | S | F1 |

---

## 6. Requerimientos no funcionales

### 6.1 Rendimiento

| ID | Requerimiento | Métrica |
|---|---|---|
| RNF-PER-01 | Tiempo de respuesta de la API | p95 < 300 ms en lecturas, p95 < 500 ms en escrituras |
| RNF-PER-02 | Cálculo de disponibilidad (1 servicio, 1 día, todas las colaboradoras) | p95 < 400 ms |
| RNF-PER-03 | Carga inicial de la página pública de reservas en 4G | LCP < 2,5 s, INP < 200 ms, CLS < 0,1 |
| RNF-PER-04 | Carga del dashboard | < 2 s con 3 años de datos |
| RNF-PER-05 | Concurrencia soportada sin degradación | 100 usuarios concurrentes (≫ necesidad actual) |

### 6.2 Disponibilidad y continuidad

| ID | Requerimiento | Métrica |
|---|---|---|
| RNF-DIS-01 | Disponibilidad mensual | ≥ 99,5 % (≈ 3,6 h de caída máxima al mes) |
| RNF-DIS-02 | Backups automáticos | Diario completo + PITR (recuperación a un punto en el tiempo) de 7 días |
| RNF-DIS-03 | RPO / RTO | RPO ≤ 15 min · RTO ≤ 4 h |
| RNF-DIS-04 | Prueba de restauración | Trimestral, documentada |
| RNF-DIS-05 | Despliegues sin caída | Estrategia rolling o blue/green |

### 6.3 Seguridad

| ID | Requerimiento |
|---|---|
| RNF-SEG-01 | HTTPS obligatorio (TLS 1.2+), HSTS. |
| RNF-SEG-02 | Contraseñas con hash **Argon2id**; política: mínimo 8 caracteres, mayúscula, minúscula, número y símbolo; bloqueo de contraseñas filtradas conocidas. |
| RNF-SEG-03 | Autorización validada **siempre en backend** (nunca solo ocultando elementos en el frontend). |
| RNF-SEG-04 | Cumplimiento de OWASP Top 10 y OWASP ASVS nivel 2 en los módulos críticos. |
| RNF-SEG-05 | Rate limiting en login, recuperación de contraseña, reservas públicas y búsqueda de clientes. |
| RNF-SEG-06 | Datos cifrados en reposo (disco y backups) y en tránsito. |
| RNF-SEG-07 | Secretos en un gestor de secretos o variables de entorno cifradas; nunca en el repositorio. |
| RNF-SEG-08 | Dependencias escaneadas automáticamente (SCA) en CI. |
| RNF-SEG-09 | Cabeceras de seguridad: CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy. |

### 6.4 Usabilidad y accesibilidad

| ID | Requerimiento | Métrica |
|---|---|---|
| RNF-USA-01 | Crear una cita desde la agenda | ≤ 4 clics / ≤ 30 s |
| RNF-USA-02 | Reserva online completa (clienta nueva) | ≤ 90 s, ≤ 6 pasos |
| RNF-USA-03 | La especialista ve su agenda del día | 1 toque tras abrir la app |
| RNF-USA-04 | Accesibilidad | WCAG 2.2 AA (contraste, teclado, etiquetas ARIA) |
| RNF-USA-05 | Curva de aprendizaje | Una especialista opera sola tras 30 min de capacitación |
| RNF-USA-06 | Idioma | Español (Bolivia); textos preparados para i18n |
| RNF-USA-07 | Mensajes de error | En lenguaje humano, con acción sugerida |

### 6.5 Compatibilidad y móvil

| ID | Requerimiento |
|---|---|
| RNF-COM-01 | Diseño **mobile-first** y responsive: 360 px a 1920 px. |
| RNF-COM-02 | Navegadores: Chrome, Safari, Edge y Firefox (últimas 2 versiones); Chrome Android 10+, Safari iOS 16+. |
| RNF-COM-03 | PWA instalable (manifest, service worker, íconos). |
| RNF-COM-04 | Tolerancia a conexión intermitente: la agenda del día queda cacheada en lectura. |

### 6.6 Mantenibilidad y calidad

| ID | Requerimiento | Métrica |
|---|---|---|
| RNF-MAN-01 | Cobertura de pruebas unitarias en dominio (disponibilidad, permisos, auditoría) | ≥ 85 % |
| RNF-MAN-02 | Cobertura global backend | ≥ 70 % |
| RNF-MAN-03 | Pruebas E2E de flujos críticos (login, crear cita, reservar online, cancelar, auditoría) | 100 % de los flujos críticos |
| RNF-MAN-04 | Linting y formato automáticos (ESLint, Prettier) y tipado estricto (TypeScript `strict`) | 0 errores en CI |
| RNF-MAN-05 | API documentada en OpenAPI 3.1, generada desde el código | Siempre actualizada |
| RNF-MAN-06 | Migraciones de base de datos versionadas y reversibles | 100 % |
| RNF-MAN-07 | Registro de decisiones de arquitectura (ADR) | Una por decisión relevante |

### 6.7 Observabilidad

| ID | Requerimiento |
|---|---|
| RNF-OBS-01 | Logs estructurados (JSON) con `request_id` correlacionado entre frontend y backend. |
| RNF-OBS-02 | Captura de errores (Sentry o similar) en frontend y backend, con alertas. |
| RNF-OBS-03 | Métricas: latencia, errores, colas, jobs fallidos. |
| RNF-OBS-04 | Monitoreo de uptime externo con alerta por email/WhatsApp al responsable técnico. |
| RNF-OBS-05 | Los logs **no** contienen contraseñas, tokens ni datos de contacto completos. |

### 6.8 Localización y datos

| ID | Requerimiento |
|---|---|
| RNF-LOC-01 | Fechas almacenadas en UTC (`timestamptz`) y mostradas en `America/La_Paz`. |
| RNF-LOC-02 | Formato de fecha `dd/mm/aaaa`, hora de 24 h (configurable a 12 h). |
| RNF-LOC-03 | Moneda Bs con 2 decimales; montos en `numeric(12,2)`, nunca en `float`. |
| RNF-LOC-04 | Teléfonos normalizados E.164 (prefijo +591 por defecto). |

### 6.9 Escalabilidad

| ID | Requerimiento |
|---|---|
| RNF-ESC-01 | Backend **stateless** (sesión en tokens y Redis), escalable horizontalmente. |
| RNF-ESC-02 | Modelo de datos multi-sede (`branch_id`) y multi-organización (`organization_id`) desde el MVP. |
| RNF-ESC-03 | Tareas asíncronas (emails, recordatorios, reportes pesados) en colas, nunca en la petición HTTP. |

### 6.10 Legal y privacidad

| ID | Requerimiento |
|---|---|
| RNF-LEG-01 | Política de privacidad y términos de uso visibles y aceptados en el registro (versión registrada). |
| RNF-LEG-02 | Consentimiento separado para comunicaciones de marketing (opt-in). |
| RNF-LEG-03 | Principio de mínimo privilegio y de minimización de datos. |
| RNF-LEG-04 | Procedimiento para solicitudes de acceso, rectificación y eliminación de datos personales. |
| RNF-LEG-05 | Datos de salud (alergias) tratados como **sensibles**: acceso restringido y auditado. |

> **Nota legal:** a la fecha de este documento, Bolivia no cuenta con una ley general de protección de datos personales equivalente al GDPR. El derecho a la privacidad está protegido constitucionalmente (acción de protección de privacidad). Se recomienda aplicar estándares internacionales (GDPR como referencia) y **validar con un asesor legal local** antes del go-live.
