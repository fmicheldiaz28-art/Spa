-- Lista de espera (Fase 2, docs/10 §17): clientas que esperan un horario en un día lleno.
-- Cuando se libera un horario compatible, el sistema les avisa por email.
CREATE TYPE waitlist_status AS ENUM ('ACTIVA', 'NOTIFICADA', 'CONVERTIDA', 'VENCIDA', 'CANCELADA');

CREATE TABLE waitlist_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid            NOT NULL REFERENCES organizations(id),
  client_id       uuid            NOT NULL REFERENCES clients(id),
  service_id      uuid            NOT NULL REFERENCES services(id),
  staff_id        uuid            REFERENCES staff_profiles(id),
  date            date            NOT NULL,
  time_from       time,
  time_to         time,
  status          waitlist_status NOT NULL DEFAULT 'ACTIVA',
  source          text            NOT NULL CHECK (source IN ('ONLINE', 'ADMIN')),
  notes           text,
  notified_at     timestamptz,
  notify_count    int             NOT NULL DEFAULT 0,
  created_at      timestamptz     NOT NULL DEFAULT now(),
  created_by      uuid            REFERENCES users(id),
  updated_at      timestamptz     NOT NULL DEFAULT now(),
  CHECK (time_from IS NULL OR time_to IS NULL OR time_from < time_to)
);

CREATE INDEX ix_waitlist_open ON waitlist_entries (organization_id, date) WHERE status IN ('ACTIVA', 'NOTIFICADA');
-- Una sola entrada abierta por clienta, servicio y día.
CREATE UNIQUE INDEX ux_waitlist_open_client_day ON waitlist_entries (client_id, service_id, date) WHERE status IN ('ACTIVA', 'NOTIFICADA');
