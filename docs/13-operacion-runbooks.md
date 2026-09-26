# 13. Operación: runbooks

Procedimientos para desplegar, respaldar y responder a incidentes en producción. Complementa [11-seguridad-auditoria.md](11-seguridad-auditoria.md) (§19–20) y el plan de despliegue de [03-arquitectura-stack.md](03-arquitectura-stack.md#711-entornos-y-despliegue).

> Convención: los comandos SQL se ejecutan con un usuario de solo lectura salvo que el paso diga lo contrario. Todo cambio manual en producción se anota en el registro de incidentes con fecha, persona y motivo.

## 13.1 Procesos en segundo plano

El API ejecuta estos procesos dentro del mismo contenedor. Todos son **idempotentes y seguros con varias instancias**: usan la base de datos como registro (índices únicos o *advisory locks*), no la memoria.

| Proceso | Frecuencia | Qué hace | Variable | Dónde ver el resultado |
|---|---|---|---|---|
| Recordatorios a clientas | `REMINDERS_INTERVAL_SEC` (60 s) | Programa y envía los avisos por email (24 h y 2 h, configurable) | `0` lo apaga | Tabla `notifications` (`template_code LIKE 'REMINDER_%'`) |
| Reporte semanal | cada 10 min (envía los lunes) | Resumen de la semana anterior a las administradoras, con el último sello de auditoría | `WEEKLY_REPORT_ENABLED=false` lo apaga | `notifications` (`WEEKLY_REPORT`) |
| Sellado de auditoría | `AUDIT_SEAL_INTERVAL_SEC` (60 s) | Encadena el hash de cada registro de `audit_logs` | `0` lo apaga | `GET /api/v1/audit-logs/integrity` |
| Lista de espera | al cambiar una cita u horario (5 s después) y cada 10 min | Cierra esperas vencidas o ya agendadas y avisa por email cuando se libera un horario compatible (como máximo cada 3 h por espera) | — | `waitlist_entries`, `notifications` (`WAITLIST_SLOT`) |
| Notificaciones push | al cambiar una cita | Avisa al celular de las especialistas y de administración (Web Push); borra suscripciones vencidas | Sin `VAPID_*` queda apagado | Tabla `push_subscriptions` |
| Tiempo real (SSE) | continuo | Avisa a las pantallas abiertas que algo cambió | — | `GET /api/v1/events` |

> Con varias instancias del API se pueden dejar todos activos en todas: el índice único de `notifications` evita envíos duplicados y `seal_audit_logs()` usa un *advisory lock*. Aun así, si se quiere un único "worker", basta con poner `REMINDERS_INTERVAL_SEC=0`, `WEEKLY_REPORT_ENABLED=false` y `AUDIT_SEAL_INTERVAL_SEC=0` en las demás.

## 13.2 Variables de entorno de producción (checklist)

| Variable | Obligatoria | Nota |
|---|---|---|
| `NODE_ENV=production` | Sí | Activa cookies `__Host-`, HSTS y bloquea el seed de demo |
| `DATABASE_URL` | Sí | Usuario de la aplicación **sin** privilegios de superusuario (no puede desactivar triggers) |
| `JWT_SECRET` | Sí | ≥ 32 caracteres aleatorios. Rotarlo cierra todas las sesiones |
| `MFA_ENCRYPTION_KEY` | Sí | 32 bytes en base64. **Guardarla en el gestor de secretos y en el respaldo de secretos**: sin ella no se pueden descifrar los secretos MFA |
| `WEB_ORIGIN` | Sí | URL pública (se usa en los enlaces de los emails) |
| `SMTP_URL`, `MAIL_FROM` | Sí | Sin `SMTP_URL`, en producción el API no envía emails y lo registra como error |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Recomendadas | Notificaciones push. Generar una vez con `pnpm --filter @naturalspa/api push:keys`; cambiarlas obliga a reactivar los avisos en cada celular |
| `SEED_DEMO` | No | Debe estar ausente o en `false` |

Generar claves: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

## 13.3 Despliegue

1. **CI en verde**: tipos, pruebas unitarias, migraciones y seed sobre una base limpia y la **prueba de humo contra PostgreSQL real** (`apps/api/scripts/smoke.mjs`: 10 reservas simultáneas → 1 creada; sellado y verificación de la auditoría; MFA).
2. **Respaldo previo**: snapshot manual de la base (además del PITR).
3. **Migraciones primero**: `pnpm --filter @naturalspa/api db:migrate`. Las migraciones son aditivas y compatibles con la versión anterior del API.
4. **Desplegar API y web**.
5. **Verificación**:
   - `GET /api/v1/health` responde 200.
   - Iniciar sesión con una cuenta de administración (con su código de verificación).
   - `GET /api/v1/audit-logs/integrity` → `ok: true`.
   - Crear y cancelar una cita de prueba; ambas aparecen en la auditoría.
6. **Reversión**: volver a la imagen anterior. Las migraciones no se revierten (son aditivas); si una migración fuera el problema, restaurar el snapshot del paso 2 (§13.4).

## 13.4 Respaldos y restauración

**Política** (docs/11 §19): respaldo diario completo + PITR de 7 días; copia semanal en otra cuenta o región; **prueba de restauración trimestral**.

**Prueba de restauración (trimestral, ~30 min):**

1. Restaurar el último respaldo en una base **temporal** (nunca sobre producción).
2. Aplicar migraciones pendientes si la base es anterior al código actual.
3. Verificar la integridad de la auditoría:
   ```sql
   SELECT * FROM verify_audit_chain();   -- problem debe ser NULL
   ```
4. Comparar con el sello del último **reporte semanal** recibido por email ("Sello de auditoría #N · abcd…"):
   ```sql
   SELECT seal_seq, encode(hash, 'hex') FROM audit_logs WHERE seal_seq = <N>;  -- debe empezar con el mismo hash
   ```
5. Contar registros clave y compararlos con producción: `clients`, `appointments` futuras, `payments` del último mes.
6. Anotar fecha, duración y resultado. Borrar la base temporal.

## 13.5 Incidentes

### A. La verificación de integridad de la auditoría falla

Síntoma: `GET /audit-logs/integrity` devuelve `ok: false` (o el botón "Verificar integridad" en Auditoría muestra ⚠), o el log del API registra `integridad comprometida`.

1. **No modificar nada** en la base. Tomar un snapshot inmediato (evidencia).
2. Anotar `problem`, `bad_seq` y `bad_id` de `SELECT * FROM verify_audit_chain();`.
3. Revisar quién tiene acceso directo a la base con privilegios que permitan saltar los triggers (superusuario, `session_replication_role`). Revisar los logs del proveedor de la base en la ventana de tiempo del registro afectado.
4. Comparar el registro afectado con el último respaldo anterior (§13.4) para ver qué cambió.
5. Rotar las credenciales de la base y de `JWT_SECRET`; revisar accesos del equipo técnico.
6. Informar a la dueña del negocio con el alcance (qué registros, desde cuándo).

> Un hueco al final de la cadena (registros recientes borrados) no se detecta solo con la cadena: por eso el reporte semanal guarda el último sello fuera del sistema. Compararlo según §13.4 paso 4.

### B. Cuenta comprometida o posible robo de sesión

Síntomas: evento `SESSION_HIJACK_SUSPECTED` o `ACCOUNT_LOCKED` repetidos en Auditoría, o la persona reporta actividad que no hizo.

1. En **Usuarios → acciones**: "Cerrar sus sesiones" y "Restablecer contraseña".
2. Si tiene verificación en dos pasos y el celular pudo verse comprometido: "Reiniciar verificación en dos pasos".
3. En **Auditoría**, filtrar por la persona y revisar qué hizo en la ventana sospechosa (y desde qué IP y dispositivo).
4. Si hubo exportaciones o revelación de contactos (`EXPORT`, `VIEW_SENSITIVE`), evaluar la fuga de datos de clientas.

### C. Una administradora perdió el celular (MFA)

1. Otra persona con permiso de usuarios (o el Super Admin) → **Usuarios → Reiniciar verificación en dos pasos**, con el motivo. Esto cierra sus sesiones.
2. La persona ingresa con su contraseña y, si la política lo exige, configura el MFA con el celular nuevo.
3. Si no hay otra administradora disponible: la persona usa uno de sus **códigos de recuperación** en el login.

### D. Los emails no llegan (recordatorios, códigos, reporte)

```sql
SELECT template_code, status, attempts, last_error, scheduled_at
FROM notifications
WHERE created_at > now() - interval '1 day' AND status IN ('FALLIDA', 'PROGRAMADA')
ORDER BY created_at DESC LIMIT 50;
```

1. Si `last_error` indica autenticación o conexión: revisar `SMTP_URL` y el estado del proveedor.
2. Los recordatorios se reintentan 3 veces cada 5 minutos. Para reintentar uno fallido después de corregir el SMTP (usuario de la aplicación):
   ```sql
   UPDATE notifications SET status = 'PROGRAMADA', attempts = 0, scheduled_at = now()
   WHERE status = 'FALLIDA' AND template_code LIKE 'REMINDER_%' AND created_at > now() - interval '1 day';
   ```
   El proceso vuelve a validar que la cita siga activa y en el mismo horario antes de enviar.

### E. Reportan una doble reserva

La restricción `ex_staff_no_overlap` de PostgreSQL lo impide para ítems activos. Verificar:

```sql
SELECT a.staff_id, a.appointment_id, b.appointment_id
FROM appointment_items a JOIN appointment_items b
  ON a.staff_id = b.staff_id AND a.id < b.id
 AND tstzrange(a.start_at, a.blocked_until) && tstzrange(b.start_at, b.blocked_until)
WHERE a.blocks_calendar AND b.blocks_calendar;
```

Si no devuelve filas, la superposición visible es un sobre-turno autorizado (`is_overbooking`, con motivo en la auditoría) o una cita cancelada que aún se muestra en la agenda.

### F. El API no responde

1. `GET /api/v1/health`. Si falla, revisar el log del contenedor.
2. Errores `P1001` (no llega a la base): estado de la base de datos gestionada y de la red.
3. Reiniciar el contenedor. Los procesos en segundo plano retoman solos (lo pendiente queda en `notifications` y los registros sin sellar se sellan en el siguiente ciclo).

## 13.6 Tareas periódicas

| Frecuencia | Tarea | Responsable |
|---|---|---|
| Semanal | Leer el reporte semanal; archivar el email (ancla de auditoría) | Dueña del negocio |
| Mensual | Revisar en Auditoría: `LOGIN_FAILED`, `ACCOUNT_LOCKED`, `VIEW_SENSITIVE`, `EXPORT`, `MFA_RESET` | Dueña del negocio |
| Mensual | Verificar integridad de la auditoría (botón en Auditoría) | Dueña del negocio |
| Trimestral | Prueba de restauración (§13.4) | Equipo técnico |
| Trimestral | Revisar usuarios activos y roles; desactivar a quien ya no trabaja en el spa | Dueña del negocio |
| Trimestral | Actualizar dependencias con avisos de seguridad | Equipo técnico |
