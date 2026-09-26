-- Preferencias de comunicación de la clienta (Fase 2, portal): puede dejar de recibir recordatorios.
ALTER TABLE clients ADD COLUMN reminders_opt_in boolean NOT NULL DEFAULT true;
