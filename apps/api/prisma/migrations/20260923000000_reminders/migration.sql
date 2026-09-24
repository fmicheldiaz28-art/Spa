-- Recordatorios automáticos (Fase 2, RF-NOT-03/04; CU-21).
-- La clienta confirma su asistencia desde el recordatorio (no cambia el estado de la cita).
ALTER TABLE appointments ADD COLUMN client_confirmed_at timestamptz;

-- Un recordatorio por cita, tipo y horario: si la cita se reagenda, el nuevo horario tiene los suyos.
-- Hace idempotente la programación aunque corran varias instancias del API.
CREATE UNIQUE INDEX ux_notif_reminder
  ON notifications (appointment_id, template_code, (payload ->> 'startAt'))
  WHERE appointment_id IS NOT NULL AND template_code LIKE 'REMINDER_%';
