-- Reporte semanal automático por email (Fase 2, docs/10 §17 "reporte semanal automático").
-- Un envío por organización, destinataria y semana: idempotente aunque corran varias instancias.
CREATE UNIQUE INDEX ux_notif_weekly_report
  ON notifications (organization_id, template_code, recipient_address, (payload ->> 'week'))
  WHERE template_code = 'WEEKLY_REPORT';
