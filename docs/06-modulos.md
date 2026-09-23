# 10. Módulos detallados

Cada módulo se describe con: **objetivo · usuarios · pantallas · funcionalidades · reglas de negocio · validaciones · casos borde · eventos auditados**.

---

## M1. Login y seguridad

**Objetivo:** que solo personas autorizadas accedan, y solo a lo que les corresponde.
**Usuarios:** todos.

**Pantallas**

| Pantalla | Ruta |
|---|---|
| Login personal | `/login` |
| Login / registro clienta | `/reservar/…/acceso`, `/mi-cuenta/login` |
| Recuperar contraseña | `/recuperar` |
| Restablecer contraseña | `/restablecer/[token]` |
| Cambio obligatorio de contraseña | `/cambiar-contrasena` (intercepta toda navegación si `must_change_password`) |
| Mi perfil y seguridad | `/app/perfil` (cambiar contraseña, sesiones activas, MFA en F2) |

**Funcionalidades**

1. Login con email y contraseña; opción "Mantener sesión" (solo clientas).
2. Logout (revoca la sesión en el servidor y borra la cookie).
3. Recuperación por email: enlace de un solo uso, 30 min, token hasheado en la BD.
4. Cambio de contraseña: exige la actual y revoca las demás sesiones.
5. Bloqueo tras 5 intentos fallidos (15 min) y aviso por email al titular.
6. Redirección por rol tras el login: SUPER_ADMIN/ADMIN → `/app/dashboard`; EMPLEADA → `/app/mi-dia`; CLIENTE → `/mi-cuenta/reservas`.

**Reglas de negocio**

- Política de contraseñas: ≥ 8 caracteres, mayúscula, minúscula, número y símbolo; no puede estar en listas de contraseñas filtradas; no puede ser igual a las últimas 3.
- La respuesta de "recuperar contraseña" es **idéntica** exista o no el email (evita enumeración de usuarios).
- El mensaje de error de login es genérico: "Email o contraseña incorrectos".
- Un usuario `INACTIVE` no puede iniciar sesión; desactivarlo cierra sus sesiones en ≤ 15 s (lista de revocación en Redis).

**Auditoría:** `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `ACCOUNT_LOCKED`, `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET`, `PASSWORD_CHANGED`, `SESSION_REVOKED`, `SESSION_HIJACK_SUSPECTED`.

---

## M2. Dashboard ejecutivo

**Objetivo:** que Natalia entienda el estado del negocio en 10 segundos.
**Usuarios:** SUPER_ADMIN, ADMIN (global) · EMPLEADA ("Mi día").

Ver el detalle completo de KPIs, fórmulas, gráficas y layout en **§16 (09-ux-ui.md)**.

**Reglas clave**

- Las ventas se calculan sobre **cobros registrados** (no sobre citas agendadas); los reembolsos restan y los cobros anulados se excluyen.
- La ocupación usa el mismo motor de disponibilidad que la agenda: una sola fuente de verdad.
- La EMPLEADA **nunca** recibe montos globales ni datos de otras colaboradoras; el endpoint `/dashboard/me` está separado y no comparte código de consulta con el global.

---

## M3. Usuarios

**Objetivo:** gestionar el acceso del personal.
**Usuarios:** SUPER_ADMIN, ADMIN.

**Pantallas:** lista `/app/usuarios` · alta y edición en panel lateral (*sheet*) · detalle con pestañas *Datos / Rol / Sesiones / Actividad (auditoría)*.

**Campos**

| Campo | Obligatorio | Validación |
|---|---|---|
| Nombre, apellido | Sí | 2–60 caracteres |
| Email | Sí | Formato válido, único |
| Teléfono | No | E.164 |
| Rol | Sí | ADMIN puede asignar: ADMIN, EMPLEADA. Solo SUPER_ADMIN asigna SUPER_ADMIN |
| Estado | Sí | Activo / Inactivo |
| Contraseña inicial | Sí (al crear) | Generada o manual; `must_change_password = true` |
| **Si es EMPLEADA:** color de agenda, servicios que realiza, reservable online, foto, fecha de ingreso | Sí / No | — |

**Reglas**

- No hay borrado físico: **desactivar**. Sus citas futuras quedan listadas para reasignar (el sistema lo advierte antes de confirmar).
- Un ADMIN no puede modificar a un SUPER_ADMIN ni elevar sus propios privilegios.
- No se puede desactivar al último SUPER_ADMIN.
- Cambiar el rol de un usuario invalida su caché de permisos inmediatamente.

**Auditoría:** `CREATE`, `UPDATE` (con diff; nunca se guarda el hash de la contraseña en el diff), `DEACTIVATE`, `ACTIVATE`, `ROLE_CHANGED`, `FORCE_PASSWORD_RESET`.

---

## M4. Clientes

**Objetivo:** ficha única y protegida de cada clienta.
**Usuarios:** ADMIN (completo) · EMPLEADA (restringido) · CLIENTE (su propio perfil).

**Pantallas**

- Lista `/app/clientes`: búsqueda instantánea, filtros (nuevas, frecuentes, inactivas > 90 días, con alergias, etiquetas), columnas: nombre, teléfono enmascarado, última visita, visitas, gasto total.
- Ficha `/app/clientes/[id]` con pestañas:
  - **Resumen:** datos, alerta de alergias (banner rojo), preferencias, estadísticas (visitas, no-show, gasto, ticket promedio, servicio favorito, colaboradora favorita).
  - **Historial:** línea de tiempo de citas.
  - **Pagos:** solo ADMIN.
  - **Notas:** observaciones internas (ADMIN) y notas de servicio (especialista).
  - **Consentimientos.**
  - **Actividad:** auditoría de la ficha.
- Alta rápida (desde la agenda): nombre + teléfono, en 1 paso.

**Matriz de visibilidad de campos**

| Campo | ADMIN | EMPLEADA (clienta asignada) | CLIENTE (ella misma) |
|---|---|---|---|
| Nombre | ✅ | ✅ nombre + inicial del apellido | ✅ |
| Teléfono / email | 🔒 enmascarado → "Ver" (auditado) | ❌ | ✅ |
| Fecha de nacimiento | ✅ | ❌ (solo 🎂 si es su cumpleaños) | ✅ |
| Alergias / contraindicaciones | ✅ | ✅ (seguridad de la clienta) | ✅ |
| Preferencias de servicio | ✅ | ✅ (y puede editarlas) | ✅ |
| Observaciones internas | ✅ | ❌ | ❌ |
| Historial de citas | ✅ todo | Solo las citas con ella | ✅ todo |
| Gasto total / pagos | ✅ | ❌ | ✅ sus pagos |
| Etiquetas | ✅ | ❌ | ❌ |

**Reglas**

- **Clienta asignada** = tiene al menos una cita con esa especialista futura o de los últimos `staff_client_visibility_months` (12 por defecto).
- La lista de clientes **no existe** para la EMPLEADA: accede a la ficha desde su cita. La búsqueda está limitada a sus clientas (máx. 20 resultados, 30 búsquedas por hora).
- Duplicados: al crear, si el teléfono o el email ya existen, se ofrece "Usar ficha existente".
- Teléfono normalizado: `70012345` → `+59170012345`.
- **Fusión:** se conserva la ficha destino; se re-apuntan citas y pagos; la ficha origen queda con `merged_into_id` (no se borra).
- **Anonimización:** reemplaza nombre por "Cliente anónimo #id", borra contacto, fecha de nacimiento y notas; conserva citas y montos para las métricas.
- Clienta con ≥ 2 no-show: etiqueta automática "Riesgo no-show" (visible solo para ADMIN) → candidata a anticipo en F3.

**Importación desde Google Sheets**

1. Natalia exporta la hoja a CSV.
2. Asistente de 4 pasos: subir → mapear columnas → vista previa con validación (teléfonos inválidos, duplicados) → importar.
3. Reporte final: importadas, fusionadas, con error (descargable).
4. `source = 'MIGRACION'`, auditado como `IMPORT`.

**Auditoría:** `CREATE`, `UPDATE`, `DELETE`, `RESTORE`, `MERGE`, `ANONYMIZE`, `VIEW_SENSITIVE` (revelar contacto), `EXPORT`, `IMPORT`.

---

## M5. Servicios

**Objetivo:** catálogo único de servicios, precios y duraciones.
**Usuarios:** ADMIN (gestión) · EMPLEADA (lectura de los suyos) · público (los reservables online).

**Pantallas:** lista agrupada por categoría con *drag & drop* para ordenar; formulario lateral.

**Campos:** nombre · categoría · descripción · duración (min) · tiempo de preparación posterior (min) · precio (Bs) · colaboradoras que lo realizan · reservable online · imagen · estado.

**Reglas**

- Duración entre 5 y 600 min, en múltiplos de 5.
- Un servicio con citas **no se elimina**: se desactiva (deja de aparecer para nuevas citas; el histórico se conserva).
- Cambiar el precio no afecta citas ya creadas (snapshot). Si hay citas futuras, el sistema pregunta: "¿Actualizar también el precio de las N citas futuras?".
- Un servicio reservable online debe tener al menos una colaboradora activa asignada.

**Auditoría:** `CREATE`, `UPDATE` (especialmente `price` y `duration_min`), `DEACTIVATE`.

---

## M6. Paquetes

**Objetivo:** vender combinaciones (Día de Novia, combos).

**Estructura de un paquete**

| Campo | Ejemplo "Día de Novia" (a validar) |
|---|---|
| Nombre | Día de Novia |
| Precio | Bs 950 (menor que la suma de sus servicios) |
| Ítems | 1) Limpieza facial (grupo 1) · 2) Masaje relajante (grupo 2) · 3) Manicure (grupo 3) · 4) Pedicure (grupo 3, **en paralelo** con la manicure) · 5) Depilación (grupo 4) |
| Reservable online | No (requiere coordinación; se agenda desde el backoffice) |

**Reglas**

- Al agendarlo se crea **una** cita con N ítems; cada ítem tiene su colaboradora y su horario.
- Ítems del mismo `parallel_group` empiezan a la misma hora con colaboradoras distintas.
- El precio del paquete se prorratea entre ítems (proporcional al precio de lista) para los reportes por servicio y por colaboradora.
- El asistente de agenda propone automáticamente la primera combinación viable ("Buscar primer horario disponible").

---

## M7. Agenda

**Objetivo:** gestionar todas las citas sin errores y sin dobles reservas.

**Vistas**

| Vista | ADMIN | EMPLEADA |
|---|---|---|
| **Día** | Columnas por colaboradora (recurso), franjas de 15 min, 09:00–19:00 | Una columna (ella) |
| **Semana** | Filtro por colaboradora o todas (colores) | Su semana |
| **Mes** | Conteo de citas por día + ocupación con color | Sus días con citas |
| **Lista** (móvil) | Agenda cronológica agrupada por colaboradora | Su lista del día (vista por defecto) |

**Elementos visuales:** tarjeta de cita con hora, clienta, servicio, ícono de estado, ⚠️ si tiene alergias, 🌐 si es reserva online, 💰 si está pagada. Zonas grises: fuera de horario, ausencias, bloqueos. Línea roja de "hora actual".

**Funciones**

| Acción | Cómo (escritorio) | Cómo (móvil) | Quién |
|---|---|---|---|
| Crear | Clic en un hueco → panel lateral precargado con colaboradora y hora | Botón flotante "+" | ADMIN |
| Ver detalle | Clic en la tarjeta → panel lateral | Toque → pantalla completa | ADMIN, EMPLEADA (propias) |
| Editar | Panel → Editar | Idem | ADMIN |
| Reagendar | Arrastrar y soltar (valida en vivo; los destinos inválidos se ven en rojo) o "Reagendar" en el panel | Botón "Reagendar" → selector de slots | ADMIN |
| Cancelar | Panel → Cancelar → motivo (lista + texto) | Idem | ADMIN |
| Check-in / completar / no-show | Botones de estado en el panel | Botones grandes en la tarjeta | ADMIN, EMPLEADA (propias) |
| Cobrar | Panel → "Cobrar" (al completar) | Idem | ADMIN |
| Eliminar | Menú "…" → Eliminar → motivo obligatorio (soft) | — | ADMIN |

**Formulario "Nueva cita" (≤ 4 clics)**

```
1. Clienta      [buscar por nombre/teléfono ▾]  [+ Nueva]
2. Servicio     [Masaje relajante · 60 min · Bs 180 ▾]   o  [Paquete ▾]
3. Colaboradora [Andrea ▾]  (solo las que realizan el servicio; "Cualquiera" disponible)
4. Fecha / hora [14/10/2026] [15:00 ▾]  (solo horas libres; sugerencias si está ocupado)
   Origen       (•) WhatsApp ( ) Teléfono ( ) Presencial
   Notas        [......................]
                              [Cancelar]  [Crear cita ✓]
```

**Reglas de negocio**

1. Validación de disponibilidad en frontend (en vivo) y en backend (transacción + restricción `EXCLUDE`).
2. Fuera de horario, en ausencias o feriados: bloqueado. ADMIN puede marcar **sobre-turno** con motivo; queda resaltado y auditado.
3. La colaboradora debe estar habilitada para el servicio (`staff_services`).
4. Cancelar exige motivo: *Clienta canceló · Clienta no puede asistir · Enfermedad de la especialista · Error de agenda · Otro (texto)*.
5. Eliminar es excepcional (citas creadas por error); motivo obligatorio y la cita **sigue existiendo** en la BD y en la auditoría. Puede restaurarse.
6. Bloqueo optimista: si otro usuario modificó la cita, aparece el aviso "Esta cita fue modificada por Natalia hace 1 min. [Ver cambios] [Recargar]".
7. Tolerancia de no-show: 15 min después del inicio, las citas sin check-in se resaltan en naranja y Natalia recibe un aviso para marcarlas.
8. Tiempo real: los cambios aparecen en las demás pantallas en < 2 s.

**Auditoría:** `CREATE`, `UPDATE`, `RESCHEDULE` (horario anterior → nuevo), `STATUS_CHANGE`, `CANCEL`, `DELETE`, `RESTORE`, `OVERBOOKING`.

---

## M8. Horarios

**Objetivo:** que la disponibilidad refleje la realidad de cada colaboradora.

**Pantallas**

- `/app/colaboradoras/[id]/horario`: editor semanal visual (tramos por día, copiar a otros días), vigencia desde.
- `/app/horarios`: calendario de ausencias del equipo (vacaciones, permisos, bloqueos), feriados y bandeja de solicitudes.
- `/app/mi-horario` (EMPLEADA): su horario, sus ausencias y el botón "Solicitar vacaciones o permiso".

**Tipos de excepción**

| Tipo | Uso | Duración | Requiere aprobación (si la solicita la empleada) |
|---|---|---|---|
| VACACIONES | Días completos | Rango de fechas | Sí |
| PERMISO | Día completo o por horas | Horas o días | Sí |
| BLOQUEO | Reunión, capacitación, mantenimiento | Horas | No (lo crea ADMIN) |
| EXTRA | Disponibilidad adicional fuera de horario | Horas | No (lo crea ADMIN) |
| FERIADO | Cierre de la sede | Día | — (tabla `holidays`) |

**Reglas**

- Los horarios nuevos se aplican **desde una fecha** (`valid_from`) y no alteran citas ya existentes; el sistema lista las citas futuras que quedarían fuera de horario.
- Al crear una ausencia que choca con citas: el modal "3 citas afectadas" ofrece **[Reagendar una por una] [Reasignar a otra colaboradora] [Cancelar y notificar]**.
- El horario de la colaboradora debe estar dentro del horario del negocio (salvo EXTRA).
- Feriados precargados: nacionales de Bolivia + 24 de septiembre (Santa Cruz). Natalia decide cuáles cierra.

**Auditoría:** `SCHEDULE_UPDATED`, `EXCEPTION_CREATED`, `EXCEPTION_REQUESTED`, `EXCEPTION_APPROVED`, `EXCEPTION_REJECTED`, `HOLIDAY_CREATED`.

---

## M9. Reservas online

**Objetivo:** que la clienta reserve sola en < 90 s, a cualquier hora.

**Canal de entrada:** `reservas.naturalspa.com.bo` (o `naturalspa.app/reservar`), enlazado desde la bio de Instagram, la respuesta automática de WhatsApp Business, Google Business Profile y un código QR en el local.

**Flujo (6 pasos, 1 por pantalla en móvil)**

| Paso | Contenido | Notas |
|---|---|---|
| 1. Servicio | Tarjetas por categoría con imagen, duración y precio | Buscador y "Más reservados" |
| 2. Especialista | "Sin preferencia" (preseleccionado) o foto + nombre | Solo las que realizan el servicio |
| 3. Fecha | Calendario del mes; días sin disponibilidad deshabilitados | Máx. 60 días |
| 4. Hora | Chips agrupados en Mañana / Tarde | Al elegir → hold de 10 min con contador visible |
| 5. Tus datos | Login o registro rápido (nombre, teléfono, email, contraseña o OTP) + consentimiento | Si ya inició sesión, se salta |
| 6. Confirmar | Resumen, notas opcionales, política de cancelación → **Confirmar reserva** | Pantalla de éxito + "Agregar al calendario" + WhatsApp del spa |

**Reglas**

- Anticipación mínima de 2 h y máxima de 60 días; hasta 3 reservas activas por clienta.
- Primera reserva: verificación por OTP (email en F1; WhatsApp en F2).
- Si la clienta ya existe (mismo teléfono o email), la reserva se vincula a su ficha; los datos nuevos **no** sobrescriben los existentes sin validación de ADMIN.
- La página nunca muestra datos de otras clientas ni nombres completos de colaboradoras (solo el nombre de pila configurado).
- Si el hold expira, el horario se libera y la clienta vuelve al paso 4 con el aviso "El horario se liberó, elige nuevamente".
- Reserva confirmada → email a la clienta + notificación interna a Natalia + evento en tiempo real en las agendas.

**Autogestión ("Mis reservas")**

- Ver las próximas y el historial.
- **Reagendar** o **cancelar** hasta 12 h antes; pasado ese plazo, botón "Contactar por WhatsApp".
- Máximo 2 reagendamientos por cita.

---

## M10. Cobros (soporte del dashboard)

- Desde el detalle de la cita: **"Cobrar Bs 180"** → método (efectivo, QR, transferencia, tarjeta) → referencia opcional → confirmar. Dos clics en el caso típico.
- Descuento con motivo (solo ADMIN).
- Pago dividido (ej. Bs 100 en efectivo + Bs 80 por QR).
- Anulación con motivo, sin edición (se anula y se vuelve a registrar).
- **Cierre de caja** diario: totales esperados por método contra montos contados, con diferencia registrada.

---

## M11. Reportes

| Reporte | Métricas | Filtros | Gráfica |
|---|---|---|---|
| **Ventas** | Total, cantidad de cobros, ticket promedio, por método, por día, comparación con el periodo anterior | Fechas, método, colaboradora, categoría | Barras por día + torta por método |
| **Servicios** | Cantidad, ingreso, % del total, duración total, tasa de cancelación por servicio | Fechas, categoría | Barras horizontales |
| **Clientes** | Nuevas, recurrentes (≥ 2 visitas), inactivas (> 90 días), top 20 por gasto, frecuencia media, retención a 60 días | Fechas | Columnas + tabla |
| **Personal** | Citas atendidas, horas trabajadas, ocupación %, ingresos generados, cancelaciones, no-show, reservas online recibidas | Fechas, colaboradora | Barras comparativas |
| **Cancelaciones / no-show** | Por motivo, por día de la semana, por servicio, por origen (online vs manual) | Fechas | Barras apiladas |
| **Mi reporte** (EMPLEADA) | Sus citas atendidas, sus horas, su ocupación | Mes | Tarjetas |

**Reglas:** exportación a XLSX/PDF solo para ADMIN, siempre auditada; los PDF llevan pie con "Generado por {usuario} el {fecha}".

---

## M12. Auditoría

Ver el diseño completo en **§20 (11-seguridad-auditoria.md)**.

**Pantalla `/app/auditoria`:**

- Tabla: fecha y hora · usuario (avatar + rol) · acción (badge de color) · módulo · entidad (enlace) · resumen ("Cambió hora 15:00 → 16:30").
- Filtros: rango de fechas, usuario, módulo, acción, texto (código de cita, nombre de clienta).
- Detalle: panel con el diff campo por campo (antes en rojo, después en verde), IP, dispositivo y request id.
- Accesos directos: desde una cita, clienta o usuario → "Ver historial".

---

## M13. Notificaciones

| Evento | Clienta | Especialista | ADMIN | Fase |
|---|---|---|---|---|
| Cita creada | Email de confirmación (+ .ics) | In-app (si es suya) | In-app si es online | F1 |
| Cita reagendada | Email | In-app | In-app si la hizo la clienta | F1 |
| Cita cancelada | Email | In-app | In-app si la hizo la clienta | F1 |
| Recordatorio 24 h | WhatsApp / email con botones | — | — | F2 |
| Recordatorio 2 h | WhatsApp | — | — | F2 |
| Resumen del día (07:30) | — | "Hoy tienes 6 citas" | Resumen del día | F2 |
| Solicitud de vacaciones | — | Resultado de la solicitud | In-app | F1 |
| Clienta con alergias hoy | — | Aviso en su cita | — | F1 |

---

## M14. Configuración

- **Negocio:** nombre, logo, dirección, teléfono, WhatsApp, redes, horario.
- **Reservas online:** activar o desactivar, anticipación, intervalo de slots, autoconfirmación, textos, portada.
- **Políticas:** cancelación, reagendamiento, tolerancia de no-show.
- **Privacidad:** meses de visibilidad para empleadas, enmascaramiento para ADMIN.
- **Seguridad:** MFA obligatorio para ADMIN (F2), duración de sesión.
- **Plantillas de mensajes** (F2).
