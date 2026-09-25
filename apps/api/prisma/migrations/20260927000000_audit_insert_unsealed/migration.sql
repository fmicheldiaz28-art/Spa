-- Endurecimiento del hash encadenado: un registro nuevo siempre llega sin sello.
-- Así nadie puede insertar filas con un hash inventado para dejarlas fuera de la cadena;
-- el único que escribe el sello es seal_audit_logs().
CREATE OR REPLACE FUNCTION audit_logs_force_unsealed() RETURNS trigger AS $$
BEGIN
  NEW.hash := NULL;
  NEW.prev_hash := NULL;
  NEW.seal_seq := NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_insert_unsealed BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_force_unsealed();
