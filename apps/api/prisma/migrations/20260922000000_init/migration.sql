-- =====================================================================
--  NaturalSpa Manager — Esquema inicial (docs/04-base-de-datos.md §9.4)
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------
--  Tipos enumerados
-- ---------------------------------------------------------------------
CREATE TYPE user_status        AS ENUM ('ACTIVE','INACTIVE','LOCKED','PENDING_VERIFICATION');
CREATE TYPE appointment_status AS ENUM ('PENDIENTE','CONFIRMADA','EN_CURSO','COMPLETADA','CANCELADA','NO_SHOW');
CREATE TYPE appointment_source AS ENUM ('ADMIN','ONLINE','WHATSAPP','TELEFONO','WALK_IN');
CREATE TYPE cancelled_by_type  AS ENUM ('CLIENTE','SPA','SISTEMA');
CREATE TYPE exception_type     AS ENUM ('VACACIONES','PERMISO','BLOQUEO','EXTRA');
CREATE TYPE exception_status   AS ENUM ('SOLICITADA','APROBADA','RECHAZADA','CANCELADA');
CREATE TYPE payment_type       AS ENUM ('COBRO','ANTICIPO','REEMBOLSO');
CREATE TYPE payment_method     AS ENUM ('EFECTIVO','QR','TRANSFERENCIA','TARJETA','OTRO');
CREATE TYPE payment_status     AS ENUM ('REGISTRADO','ANULADO');
CREATE TYPE notif_channel      AS ENUM ('EMAIL','WHATSAPP','SMS','INTERNAL');
CREATE TYPE notif_status       AS ENUM ('PROGRAMADA','ENVIADA','ENTREGADA','LEIDA','FALLIDA','CANCELADA');
CREATE TYPE job_status         AS ENUM ('PENDIENTE','PROCESANDO','COMPLETADO','FALLIDO','EXPIRADO');

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- =====================================================================
--  ORGANIZACIÓN
-- =====================================================================
CREATE TABLE organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  legal_name    text,
  slug          text        NOT NULL UNIQUE,
  tax_id        text,
  email         citext,
  phone         text,
  logo_url      text,
  timezone      text        NOT NULL DEFAULT 'America/La_Paz',
  currency      char(3)     NOT NULL DEFAULT 'BOB',
  locale        text        NOT NULL DEFAULT 'es-BO',
  settings      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_org_updated BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE branches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id),
  name            text        NOT NULL,
  slug            text        NOT NULL,
  address         text,
  city            text        DEFAULT 'Santa Cruz de la Sierra',
  phone           text,
  latitude        numeric(9,6),
  longitude       numeric(9,6),
  timezone        text        NOT NULL DEFAULT 'America/La_Paz',
  settings        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);
CREATE TRIGGER trg_branch_updated BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- weekday ISO: 1=lunes … 7=domingo
CREATE TABLE business_hours (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   uuid     NOT NULL REFERENCES branches(id),
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  open_time   time     NOT NULL,
  close_time  time     NOT NULL,
  CHECK (open_time < close_time)
);
CREATE INDEX ix_business_hours_branch ON business_hours(branch_id, weekday);

CREATE TABLE holidays (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   uuid    NOT NULL REFERENCES branches(id),
  date        date    NOT NULL,
  name        text    NOT NULL,
  is_closed   boolean NOT NULL DEFAULT true,
  open_time   time,
  close_time  time,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  UNIQUE (branch_id, date),
  CHECK (is_closed OR (open_time IS NOT NULL AND close_time IS NOT NULL AND open_time < close_time))
);

CREATE TABLE resources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   uuid    NOT NULL REFERENCES branches(id),
  name        text    NOT NULL,
  type        text    NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
--  IDENTIDAD Y ACCESO
-- =====================================================================
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid REFERENCES organizations(id),
  email                 citext      NOT NULL UNIQUE,
  password_hash         text        NOT NULL,
  first_name            text        NOT NULL,
  last_name             text        NOT NULL DEFAULT '',
  phone_e164            text,
  avatar_url            text,
  status                user_status NOT NULL DEFAULT 'ACTIVE',
  must_change_password  boolean     NOT NULL DEFAULT false,
  email_verified_at     timestamptz,
  failed_login_count    int         NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  password_changed_at   timestamptz,
  mfa_enabled           boolean     NOT NULL DEFAULT false,
  mfa_secret_enc        bytea,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES users(id),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid REFERENCES users(id),
  deleted_at            timestamptz,
  deleted_by            uuid REFERENCES users(id)
);
CREATE INDEX ix_users_org_status ON users(organization_id, status) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE roles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id),
  code            text    NOT NULL,
  name            text    NOT NULL,
  description     text,
  is_system       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (organization_id, code)
);

CREATE TABLE permissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text    NOT NULL UNIQUE,
  module       text    NOT NULL,
  description  text    NOT NULL,
  is_sensitive boolean NOT NULL DEFAULT false
);

CREATE TABLE role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  granted_by    uuid REFERENCES users(id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  user_id    uuid NOT NULL REFERENCES users(id),
  role_id    uuid NOT NULL REFERENCES roles(id),
  branch_id  uuid REFERENCES branches(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES users(id),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES users(id),
  family_id           uuid        NOT NULL,
  refresh_token_hash  text        NOT NULL UNIQUE,
  user_agent          text,
  ip                  inet,
  device_label        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_used_at        timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz,
  revoked_reason      text,
  replaced_by         uuid REFERENCES sessions(id)
);
CREATE INDEX ix_sessions_user_active ON sessions(user_id) WHERE revoked_at IS NULL;
CREATE INDEX ix_sessions_family ON sessions(family_id);

CREATE TABLE password_reset_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users(id),
  token_hash   text        NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  requested_ip inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE verification_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target      text        NOT NULL,
  purpose     text        NOT NULL,
  code_hash   text        NOT NULL,
  attempts    int         NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_verif_target ON verification_codes(target, purpose) WHERE consumed_at IS NULL;

-- =====================================================================
--  PERSONAL
-- =====================================================================
CREATE TABLE staff_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid    NOT NULL REFERENCES organizations(id),
  branch_id           uuid    NOT NULL REFERENCES branches(id),
  user_id             uuid    NOT NULL UNIQUE REFERENCES users(id),
  display_name        text    NOT NULL,
  color               text    NOT NULL DEFAULT '#7C9A82',
  bio                 text,
  photo_url           text,
  is_bookable_online  boolean NOT NULL DEFAULT true,
  sort_order          int     NOT NULL DEFAULT 0,
  hired_at            date,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES users(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES users(id)
);
CREATE TRIGGER trg_staff_updated BEFORE UPDATE ON staff_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE work_schedules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    uuid     NOT NULL REFERENCES staff_profiles(id),
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time  time     NOT NULL,
  end_time    time     NOT NULL,
  valid_from  date     NOT NULL DEFAULT current_date,
  valid_to    date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users(id),
  CHECK (start_time < end_time),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX ix_work_sched_staff ON work_schedules(staff_id, weekday);

CREATE TABLE schedule_exceptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid             NOT NULL REFERENCES organizations(id),
  branch_id        uuid             NOT NULL REFERENCES branches(id),
  staff_id         uuid             REFERENCES staff_profiles(id),
  type             exception_type   NOT NULL,
  status           exception_status NOT NULL DEFAULT 'APROBADA',
  start_at         timestamptz      NOT NULL,
  end_at           timestamptz      NOT NULL,
  all_day          boolean          NOT NULL DEFAULT false,
  reason           text,
  requested_by     uuid REFERENCES users(id),
  approved_by      uuid REFERENCES users(id),
  approved_at      timestamptz,
  rejection_reason text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES users(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES users(id),
  deleted_at       timestamptz,
  CHECK (start_at < end_at)
);
CREATE INDEX ix_exc_staff_range ON schedule_exceptions USING gist (staff_id, tstzrange(start_at, end_at))
  WHERE deleted_at IS NULL AND status = 'APROBADA';
CREATE TRIGGER trg_exc_updated BEFORE UPDATE ON schedule_exceptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
--  CATÁLOGO
-- =====================================================================
CREATE TABLE service_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid    NOT NULL REFERENCES organizations(id),
  name            text    NOT NULL,
  slug            text    NOT NULL,
  color           text,
  icon            text,
  sort_order      int     NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  UNIQUE (organization_id, slug)
);

CREATE TABLE services (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid          NOT NULL REFERENCES organizations(id),
  category_id         uuid          NOT NULL REFERENCES service_categories(id),
  name                text          NOT NULL,
  slug                text          NOT NULL,
  description         text,
  duration_min        int           NOT NULL CHECK (duration_min BETWEEN 5 AND 600),
  buffer_before_min   int           NOT NULL DEFAULT 0 CHECK (buffer_before_min >= 0),
  buffer_after_min    int           NOT NULL DEFAULT 10 CHECK (buffer_after_min >= 0),
  price               numeric(12,2) NOT NULL CHECK (price >= 0),
  currency            char(3)       NOT NULL DEFAULT 'BOB',
  resource_type       text,
  image_url           text,
  is_active           boolean       NOT NULL DEFAULT true,
  is_online_bookable  boolean       NOT NULL DEFAULT true,
  sort_order          int           NOT NULL DEFAULT 0,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES users(id),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES users(id),
  deleted_at          timestamptz,
  UNIQUE (organization_id, slug)
);
CREATE TRIGGER trg_services_updated BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE staff_services (
  staff_id            uuid NOT NULL REFERENCES staff_profiles(id),
  service_id          uuid NOT NULL REFERENCES services(id),
  custom_price        numeric(12,2) CHECK (custom_price >= 0),
  custom_duration_min int CHECK (custom_duration_min > 0),
  PRIMARY KEY (staff_id, service_id)
);
CREATE INDEX ix_staff_services_service ON staff_services(service_id);

CREATE TABLE packages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid          NOT NULL REFERENCES organizations(id),
  name                text          NOT NULL,
  slug                text          NOT NULL,
  description         text,
  price               numeric(12,2) NOT NULL CHECK (price >= 0),
  currency            char(3)       NOT NULL DEFAULT 'BOB',
  image_url           text,
  is_active           boolean       NOT NULL DEFAULT true,
  is_online_bookable  boolean       NOT NULL DEFAULT false,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES users(id),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES users(id),
  deleted_at          timestamptz,
  UNIQUE (organization_id, slug)
);
CREATE TRIGGER trg_packages_updated BEFORE UPDATE ON packages FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE package_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id      uuid NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  service_id      uuid NOT NULL REFERENCES services(id),
  sequence        int  NOT NULL,
  parallel_group  int  NOT NULL,
  UNIQUE (package_id, sequence)
);

-- =====================================================================
--  CLIENTES
-- =====================================================================
CREATE TABLE clients (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid    NOT NULL REFERENCES organizations(id),
  user_id               uuid    UNIQUE REFERENCES users(id),
  first_name            text    NOT NULL,
  last_name             text    NOT NULL DEFAULT '',
  phone_e164            text,
  email                 citext,
  birth_date            date,
  gender                text,
  preferences           text,
  allergies             text,
  contraindications     text,
  internal_notes        text,
  source                text,
  tags                  text[]  NOT NULL DEFAULT '{}',
  preferred_staff_id    uuid REFERENCES staff_profiles(id),
  marketing_opt_in      boolean NOT NULL DEFAULT false,
  first_visit_at        timestamptz,
  last_visit_at         timestamptz,
  visits_count          int           NOT NULL DEFAULT 0,
  no_show_count         int           NOT NULL DEFAULT 0,
  total_spent           numeric(12,2) NOT NULL DEFAULT 0,
  is_active             boolean       NOT NULL DEFAULT true,
  merged_into_id        uuid REFERENCES clients(id),
  anonymized_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES users(id),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid REFERENCES users(id),
  deleted_at            timestamptz,
  deleted_by            uuid REFERENCES users(id),
  delete_reason         text
);
CREATE UNIQUE INDEX ux_clients_phone ON clients(organization_id, phone_e164)
  WHERE deleted_at IS NULL AND merged_into_id IS NULL AND phone_e164 IS NOT NULL;
CREATE UNIQUE INDEX ux_clients_email ON clients(organization_id, email)
  WHERE deleted_at IS NULL AND merged_into_id IS NULL AND email IS NOT NULL;
CREATE INDEX ix_clients_name_trgm ON clients USING gin ((first_name || ' ' || last_name) gin_trgm_ops);
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE client_consents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid        NOT NULL REFERENCES clients(id),
  consent_type    text        NOT NULL,
  granted         boolean     NOT NULL,
  policy_version  text,
  channel         text,
  ip              inet,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id)
);

-- =====================================================================
--  CITAS
-- =====================================================================
CREATE SEQUENCE appointment_code_seq;

CREATE OR REPLACE FUNCTION next_appointment_code() RETURNS text AS $$
  SELECT 'NS-' || to_char(now() AT TIME ZONE 'America/La_Paz', 'YYYY') || '-'
         || lpad(nextval('appointment_code_seq')::text, 6, '0');
$$ LANGUAGE sql VOLATILE;

CREATE TABLE appointments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid               NOT NULL REFERENCES organizations(id),
  branch_id             uuid               NOT NULL REFERENCES branches(id),
  code                  text               NOT NULL UNIQUE DEFAULT next_appointment_code(),
  client_id             uuid               NOT NULL REFERENCES clients(id),
  package_id            uuid               REFERENCES packages(id),
  status                appointment_status NOT NULL DEFAULT 'CONFIRMADA',
  source                appointment_source NOT NULL,
  start_at              timestamptz        NOT NULL,
  end_at                timestamptz        NOT NULL,
  subtotal              numeric(12,2)      NOT NULL DEFAULT 0,
  discount              numeric(12,2)      NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total                 numeric(12,2)      NOT NULL DEFAULT 0 CHECK (total >= 0),
  currency              char(3)            NOT NULL DEFAULT 'BOB',
  client_notes          text,
  internal_notes        text,
  is_overbooking        boolean            NOT NULL DEFAULT false,
  overbooking_reason    text,
  confirmed_at          timestamptz,
  checked_in_at         timestamptz,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  cancelled_by          uuid REFERENCES users(id),
  cancelled_by_type     cancelled_by_type,
  cancel_reason         text,
  no_show_at            timestamptz,
  reschedule_count      int                NOT NULL DEFAULT 0,
  manage_token_hash     text,
  version               int                NOT NULL DEFAULT 1,
  created_at            timestamptz        NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES users(id),
  updated_at            timestamptz        NOT NULL DEFAULT now(),
  updated_by            uuid REFERENCES users(id),
  deleted_at            timestamptz,
  deleted_by            uuid REFERENCES users(id),
  delete_reason         text,
  CHECK (start_at < end_at),
  CHECK (status <> 'CANCELADA' OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL)),
  CHECK (deleted_at IS NULL OR delete_reason IS NOT NULL),
  CHECK (NOT is_overbooking OR overbooking_reason IS NOT NULL)
);
CREATE INDEX ix_appt_branch_start ON appointments(branch_id, start_at) WHERE deleted_at IS NULL;
CREATE INDEX ix_appt_client       ON appointments(client_id, start_at DESC);
CREATE INDEX ix_appt_status       ON appointments(organization_id, status, start_at);
CREATE TRIGGER trg_appt_updated BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE appointment_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid          NOT NULL REFERENCES organizations(id),
  appointment_id        uuid          NOT NULL REFERENCES appointments(id),
  service_id            uuid          NOT NULL REFERENCES services(id),
  staff_id              uuid          NOT NULL REFERENCES staff_profiles(id),
  resource_id           uuid          REFERENCES resources(id),
  start_at              timestamptz   NOT NULL,
  end_at                timestamptz   NOT NULL,
  blocked_until         timestamptz   NOT NULL,
  service_name          text          NOT NULL,
  duration_min          int           NOT NULL,
  price                 numeric(12,2) NOT NULL,
  blocks_calendar       boolean       NOT NULL DEFAULT true,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),
  CHECK (start_at < end_at AND end_at <= blocked_until),
  -- Garantía anti doble reserva a nivel de motor
  CONSTRAINT ex_staff_no_overlap EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(start_at, blocked_until, '[)') WITH &&
  ) WHERE (blocks_calendar),
  CONSTRAINT ex_resource_no_overlap EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(start_at, blocked_until, '[)') WITH &&
  ) WHERE (blocks_calendar AND resource_id IS NOT NULL)
);
CREATE INDEX ix_items_staff_start ON appointment_items(staff_id, start_at) WHERE blocks_calendar;
CREATE INDEX ix_items_appt ON appointment_items(appointment_id);
CREATE TRIGGER trg_items_updated BEFORE UPDATE ON appointment_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION sync_items_blocking() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     OR NEW.is_overbooking IS DISTINCT FROM OLD.is_overbooking THEN
    UPDATE appointment_items
       SET blocks_calendar = (NEW.deleted_at IS NULL
                              AND NEW.status IN ('PENDIENTE','CONFIRMADA','EN_CURSO')
                              AND NOT NEW.is_overbooking)
     WHERE appointment_id = NEW.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_appt_sync_items AFTER UPDATE OF status, deleted_at, is_overbooking ON appointments
  FOR EACH ROW EXECUTE FUNCTION sync_items_blocking();

CREATE TABLE appointment_status_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  uuid               NOT NULL REFERENCES appointments(id),
  from_status     appointment_status,
  to_status       appointment_status NOT NULL,
  changed_by      uuid REFERENCES users(id),
  actor_type      text               NOT NULL,
  reason          text,
  metadata        jsonb,
  created_at      timestamptz        NOT NULL DEFAULT now()
);
CREATE INDEX ix_status_hist_appt ON appointment_status_history(appointment_id, created_at);

-- =====================================================================
--  COBROS
-- =====================================================================
CREATE TABLE payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid           NOT NULL REFERENCES organizations(id),
  branch_id         uuid           NOT NULL REFERENCES branches(id),
  appointment_id    uuid           REFERENCES appointments(id),
  client_id         uuid           REFERENCES clients(id),
  type              payment_type   NOT NULL DEFAULT 'COBRO',
  method            payment_method NOT NULL,
  amount            numeric(12,2)  NOT NULL CHECK (amount > 0),
  currency          char(3)        NOT NULL DEFAULT 'BOB',
  reference         text,
  status            payment_status NOT NULL DEFAULT 'REGISTRADO',
  notes             text,
  received_by       uuid           NOT NULL REFERENCES users(id),
  paid_at           timestamptz    NOT NULL DEFAULT now(),
  voided_at         timestamptz,
  voided_by         uuid REFERENCES users(id),
  void_reason       text,
  external_provider text,
  external_id       text,
  created_at        timestamptz    NOT NULL DEFAULT now(),
  CHECK (status <> 'ANULADO' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);
CREATE INDEX ix_payments_branch_paid ON payments(branch_id, paid_at) WHERE status = 'REGISTRADO';
CREATE INDEX ix_payments_appt ON payments(appointment_id);

CREATE TABLE cash_closures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       uuid          NOT NULL REFERENCES branches(id),
  business_date   date          NOT NULL,
  expected_totals jsonb         NOT NULL,
  counted_totals  jsonb         NOT NULL,
  difference      numeric(12,2) NOT NULL,
  notes           text,
  closed_by       uuid          NOT NULL REFERENCES users(id),
  closed_at       timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (branch_id, business_date)
);

-- =====================================================================
--  NOTIFICACIONES Y EVENTOS
-- =====================================================================
CREATE TABLE notification_templates (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid          REFERENCES organizations(id),
  code                   text          NOT NULL,
  channel                notif_channel NOT NULL,
  locale                 text          NOT NULL DEFAULT 'es-BO',
  subject                text,
  body                   text          NOT NULL,
  provider_template_name text,
  is_active              boolean       NOT NULL DEFAULT true,
  version                int           NOT NULL DEFAULT 1,
  updated_at             timestamptz   NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (organization_id, code, channel, locale)
);

CREATE TABLE notifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid          NOT NULL REFERENCES organizations(id),
  channel             notif_channel NOT NULL,
  template_code       text          NOT NULL,
  recipient_user_id   uuid REFERENCES users(id),
  recipient_client_id uuid REFERENCES clients(id),
  recipient_address   text,
  appointment_id      uuid REFERENCES appointments(id),
  payload             jsonb         NOT NULL DEFAULT '{}'::jsonb,
  status              notif_status  NOT NULL DEFAULT 'PROGRAMADA',
  scheduled_at        timestamptz   NOT NULL DEFAULT now(),
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,
  attempts            int           NOT NULL DEFAULT 0,
  last_error          text,
  provider_message_id text,
  created_at          timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX ix_notif_due ON notifications(status, scheduled_at) WHERE status = 'PROGRAMADA';
CREATE INDEX ix_notif_inbox ON notifications(recipient_user_id, created_at DESC) WHERE channel = 'INTERNAL';

CREATE TABLE outbox_events (
  id              bigserial PRIMARY KEY,
  organization_id uuid        NOT NULL,
  aggregate_type  text        NOT NULL,
  aggregate_id    uuid        NOT NULL,
  event_type      text        NOT NULL,
  payload         jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  attempts        int         NOT NULL DEFAULT 0
);
CREATE INDEX ix_outbox_pending ON outbox_events(id) WHERE published_at IS NULL;

-- =====================================================================
--  EXPORTACIONES / IMPORTACIONES
-- =====================================================================
CREATE TABLE export_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id),
  requested_by    uuid        NOT NULL REFERENCES users(id),
  export_type     text        NOT NULL,
  filters         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  reason          text        NOT NULL,
  format          text        NOT NULL,
  status          job_status  NOT NULL DEFAULT 'PENDIENTE',
  row_count       int,
  file_key        text,
  expires_at      timestamptz,
  downloaded_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE import_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id),
  requested_by    uuid        NOT NULL REFERENCES users(id),
  import_type     text        NOT NULL,
  status          job_status  NOT NULL DEFAULT 'PENDIENTE',
  total_rows      int,
  imported_rows   int,
  duplicate_rows  int,
  error_rows      int,
  report          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);

-- =====================================================================
--  AUDITORÍA (append-only, particionada por mes)
-- =====================================================================
CREATE TABLE audit_logs (
  id              bigserial,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  organization_id uuid,
  branch_id       uuid,
  actor_user_id   uuid,
  actor_type      text        NOT NULL,
  actor_role      text,
  actor_name      text,
  action          text        NOT NULL,
  module          text        NOT NULL,
  entity_type     text,
  entity_id       uuid,
  entity_label    text,
  old_values      jsonb,
  new_values      jsonb,
  changed_fields  text[]      NOT NULL DEFAULT '{}',
  reason          text,
  ip              inet,
  user_agent      text,
  request_id      text,
  session_id      uuid,
  prev_hash       bytea,
  hash            bytea,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- Partición por defecto: ninguna inserción falla aunque falte la partición del mes.
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;

-- Crea las particiones mensuales faltantes (se ejecuta aquí y luego desde un job mensual).
CREATE OR REPLACE FUNCTION ensure_audit_partitions(months_ahead int DEFAULT 12) RETURNS void AS $$
DECLARE
  m date := date_trunc('month', now())::date;
  part text;
BEGIN
  FOR i IN 0..months_ahead LOOP
    part := 'audit_logs_' || to_char(m, 'YYYY_MM');
    IF to_regclass(part) IS NULL THEN
      EXECUTE format('CREATE TABLE %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
                     part, m, (m + interval '1 month')::date);
    END IF;
    m := (m + interval '1 month')::date;
  END LOOP;
END $$ LANGUAGE plpgsql;

SELECT ensure_audit_partitions(12);

CREATE INDEX ix_audit_entity ON audit_logs(entity_type, entity_id, occurred_at DESC);
CREATE INDEX ix_audit_actor  ON audit_logs(actor_user_id, occurred_at DESC);
CREATE INDEX ix_audit_module ON audit_logs(organization_id, module, action, occurred_at DESC);

CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs es append-only: % no permitido', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
CREATE TRIGGER trg_audit_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

-- =====================================================================
--  VISTAS DE REPORTES
-- =====================================================================
CREATE VIEW v_appointment_facts AS
SELECT
  a.organization_id, a.branch_id, a.id AS appointment_id, a.code, a.status, a.source,
  (a.start_at AT TIME ZONE b.timezone)::date AS local_date,
  i.staff_id, sp.display_name AS staff_name,
  i.service_id, i.service_name, s.category_id,
  i.duration_min, i.price,
  a.client_id, a.created_at, a.cancelled_by_type
FROM appointments a
JOIN appointment_items i ON i.appointment_id = a.id
JOIN branches b          ON b.id = a.branch_id
JOIN staff_profiles sp   ON sp.id = i.staff_id
JOIN services s          ON s.id = i.service_id
WHERE a.deleted_at IS NULL;

CREATE MATERIALIZED VIEW mv_daily_sales AS
SELECT p.organization_id, p.branch_id,
       (p.paid_at AT TIME ZONE b.timezone)::date AS local_date,
       p.method,
       sum(CASE WHEN p.type = 'REEMBOLSO' THEN -p.amount ELSE p.amount END) AS amount,
       count(*) AS payments
FROM payments p
JOIN branches b ON b.id = p.branch_id
WHERE p.status = 'REGISTRADO'
GROUP BY 1, 2, 3, 4;
CREATE UNIQUE INDEX ux_mv_daily_sales ON mv_daily_sales(organization_id, branch_id, local_date, method);
