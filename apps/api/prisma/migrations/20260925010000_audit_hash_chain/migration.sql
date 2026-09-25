-- Integridad criptográfica de la auditoría (docs/11-seguridad-auditoria.md §195, Fase 2).
--
-- Cada registro se "sella" en orden: hash = SHA-256(prev_hash ‖ json canónico del registro).
-- `seal_seq` es la posición en la cadena (orden de sellado, no de id: una transacción que
-- confirma tarde se sella después sin romper nada). Alterar, borrar o reordenar un registro
-- sellado —aunque sea con privilegios que salten los triggers— rompe la cadena y
-- verify_audit_chain() lo detecta.

ALTER TABLE audit_logs ADD COLUMN seal_seq bigint;
CREATE INDEX ix_audit_unsealed ON audit_logs (id) WHERE hash IS NULL;
CREATE INDEX ix_audit_seal_seq ON audit_logs (seal_seq) WHERE seal_seq IS NOT NULL;

-- Contenido que se firma: todo el registro salvo los campos del propio sello, con la fecha
-- como epoch (independiente de la zona horaria de la sesión) y la posición en la cadena.
CREATE OR REPLACE FUNCTION audit_seal_payload(r audit_logs, seq bigint) RETURNS bytea AS $$
  SELECT convert_to(
    ((to_jsonb(r) - 'hash' - 'prev_hash' - 'seal_seq' - 'occurred_at')
      || jsonb_build_object('occurred_at', extract(epoch FROM r.occurred_at)::text, 'seal_seq', seq))::text,
    'UTF8')
$$ LANGUAGE sql IMMUTABLE;

-- Append-only, con una única excepción: escribir el sello (una sola vez) sin tocar nada más.
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.hash IS NULL AND NEW.hash IS NOT NULL AND NEW.seal_seq IS NOT NULL
     AND (to_jsonb(NEW) - 'hash' - 'prev_hash' - 'seal_seq') = (to_jsonb(OLD) - 'hash' - 'prev_hash' - 'seal_seq') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs es append-only: % no permitido', TG_OP;
END;
$$ LANGUAGE plpgsql;

-- Sella hasta `batch` registros pendientes con al menos `min_age` de antigüedad.
-- Un solo sellador a la vez (advisory lock): seguro con varias instancias del API.
CREATE OR REPLACE FUNCTION seal_audit_logs(batch int DEFAULT 500, min_age interval DEFAULT '1 minute') RETURNS int AS $$
DECLARE
  r    audit_logs;
  head bytea;
  seq  bigint;
  n    int := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('audit_logs_seal')) THEN
    RETURN 0;
  END IF;
  SELECT a.hash, a.seal_seq INTO head, seq FROM audit_logs a WHERE a.seal_seq IS NOT NULL ORDER BY a.seal_seq DESC LIMIT 1;
  seq := coalesce(seq, 0);
  FOR r IN
    SELECT * FROM audit_logs a WHERE a.hash IS NULL AND a.occurred_at < now() - min_age ORDER BY a.id LIMIT batch
  LOOP
    seq := seq + 1;
    UPDATE audit_logs a
       SET seal_seq = seq,
           prev_hash = head,
           hash = sha256(coalesce(head, ''::bytea) || audit_seal_payload(r, seq))
     WHERE a.id = r.id AND a.occurred_at = r.occurred_at
    RETURNING a.hash INTO head;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

-- Recalcula toda la cadena. Devuelve cuántos registros verificó y el primer problema, si hay.
CREATE OR REPLACE FUNCTION verify_audit_chain()
RETURNS TABLE (checked bigint, unsealed bigint, head_seq bigint, bad_seq bigint, bad_id bigint, problem text) AS $$
DECLARE
  r        audit_logs;
  prev     bytea := NULL;
  expected bigint := 1;
  n        bigint := 0;
  pending  bigint;
BEGIN
  SELECT count(*) INTO pending FROM audit_logs a WHERE a.hash IS NULL;
  FOR r IN SELECT * FROM audit_logs a WHERE a.seal_seq IS NOT NULL ORDER BY a.seal_seq LOOP
    IF r.seal_seq <> expected THEN
      RETURN QUERY SELECT n, pending, expected - 1, expected, NULL::bigint, 'Falta un registro sellado (posible borrado)';
      RETURN;
    END IF;
    IF r.prev_hash IS DISTINCT FROM prev THEN
      RETURN QUERY SELECT n, pending, expected - 1, r.seal_seq, r.id, 'La cadena está rota (registro anterior alterado o reemplazado)';
      RETURN;
    END IF;
    IF r.hash IS DISTINCT FROM sha256(coalesce(prev, ''::bytea) || audit_seal_payload(r, r.seal_seq)) THEN
      RETURN QUERY SELECT n, pending, expected - 1, r.seal_seq, r.id, 'El contenido del registro fue alterado';
      RETURN;
    END IF;
    prev := r.hash;
    expected := expected + 1;
    n := n + 1;
  END LOOP;
  RETURN QUERY SELECT n, pending, expected - 1, NULL::bigint, NULL::bigint, NULL::text;
END;
$$ LANGUAGE plpgsql;
