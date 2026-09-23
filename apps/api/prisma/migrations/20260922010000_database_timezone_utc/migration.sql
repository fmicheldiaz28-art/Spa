-- Las fechas se almacenan en UTC (RNF-LOC-01). Fija UTC como zona por defecto de la base para
-- toda sesión nueva; la API además lo fuerza por conexión (create-adapter.ts).
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
END $$;
