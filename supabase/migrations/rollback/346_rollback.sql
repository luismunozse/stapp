-- Rollback de la migracion 346.
--
-- OJO: descarta la lista de inscriptos a la beta de Android. Si todavia hay
-- PENDIENTE sin cargar en Play Console, copiarlos antes.

DROP TABLE IF EXISTS android_beta_testers;
