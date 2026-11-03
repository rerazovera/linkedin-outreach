# Reparar Access denied for user outreach

El mensaje `Access denied ... (using password: YES)` confirma que la red entre API y MariaDB funciona, pero las credenciales o permisos no coinciden. Cambiar `.env` no cambia las credenciales de un volumen MariaDB ya inicializado.

1. Conserva tu `.env` original y el volumen `dbdata`.
2. Desde la carpeta del proyecto ejecuta `bash scripts/reparar-credenciales.sh`.
3. Confirma la operación e introduce la contraseña **root actual** de MariaDB cuando se solicite (no necesariamente coincide con la variable actual del `.env`).
4. Comprueba `docker compose logs --tail=50 api` y `curl -i http://localhost:8080/api/health`.

El script obtiene `DB_USER`, `DB_PASSWORD` y `DB_NAME` desde `docker compose config`, actualiza la cuenta `usuario@'%'` y concede permisos sobre la base existente. No elimina tablas ni volúmenes. Si la cuenta tiene una entrada más específica para el host del backend, esa entrada puede prevalecer; inspecciona `SELECT User,Host FROM mysql.user WHERE User='outreach';` con root y ajusta dicha cuenta también.

Si desconoces la contraseña root actual, no intentes borrar el volumen. Recupera primero el acceso administrativo a MariaDB.

**Nunca ejecutes `docker compose down -v` para corregir este problema.**
