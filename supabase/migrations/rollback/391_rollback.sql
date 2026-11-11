-- Rollback de refresh_tokens_por_sesion (migración 391).
--
-- ORDEN: primero volver a desplegar el código anterior. Con el código nuevo en
-- línea y sin la tabla, ningún login puede guardar su refresh token.
--
-- Efecto: se pierden todas las sesiones guardadas en la tabla. Las cookies
-- vigentes siguen funcionando con el código anterior (no revalidaba), pero la
-- PWA no podrá restaurar esas sesiones y los usuarios tendrán que volver a
-- iniciar sesión cuando su cookie se borre.

SET LOCAL lock_timeout = '3s';

DROP TABLE IF EXISTS refresh_tokens;
