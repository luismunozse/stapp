-- Normaliza a minúsculas los emails de usuarios guardados con mayúsculas.
--
-- Todos los logins (password y Google) buscan con `.eq("email", lower(trim(...)))`
-- y PostgREST compara case-sensitive. Los técnicos y vendedores creados desde el
-- panel se guardaban con el email tal cual lo tipeó el admin, así que un
-- "Juan@Gmail.com" nunca se encontraba y no podía iniciar sesión.
--
-- Se saltean los casos en que la versión en minúsculas ya existe en otra fila
-- (colisión con el UNIQUE de email): esos hay que resolverlos a mano.
UPDATE users u
SET email = lower(trim(u.email))
WHERE u.email <> lower(trim(u.email))
  AND NOT EXISTS (
    SELECT 1 FROM users o
    WHERE o.id <> u.id
      AND o.email = lower(trim(u.email))
  );
