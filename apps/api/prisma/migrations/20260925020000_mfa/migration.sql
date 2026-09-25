-- Verificación en dos pasos (TOTP) para administración (docs/11-seguridad-auditoria.md §30, Fase 2).
-- mfa_secret_enc (ya existente) guarda el secreto cifrado con AES-256-GCM; mientras mfa_enabled
-- es false, el secreto está pendiente de confirmación.
ALTER TABLE users
  ADD COLUMN mfa_enabled_at     timestamptz,
  ADD COLUMN mfa_last_step      bigint,
  ADD COLUMN mfa_recovery_hashes text[] NOT NULL DEFAULT '{}';
