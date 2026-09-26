-- Notificaciones push (Fase 2, docs/09-ux-ui.md §582): suscripciones Web Push por dispositivo.
CREATE TABLE push_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint      text        NOT NULL UNIQUE,
  p256dh        text        NOT NULL,
  auth          text        NOT NULL,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  failures      int         NOT NULL DEFAULT 0
);
CREATE INDEX ix_push_user ON push_subscriptions (user_id);
