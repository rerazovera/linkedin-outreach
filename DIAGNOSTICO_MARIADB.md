# Diagnóstico de MariaDB (error 45028)

El error de pool `active=0 idle=0` es genérico: NO prueba que se agotaron conexiones. Suele indicar credenciales incorrectas, fallo DNS/red o que MariaDB no acepta conexiones.

## 1. Inspeccionar servicios y registros

```bash
docker compose ps
docker compose logs --tail=120 db
docker compose logs --tail=120 api
docker compose config
```

## 2. Probar usuario de aplicación desde MariaDB

```bash
docker compose exec db sh -c 'mariadb -h 127.0.0.1 -u "$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" -e "SELECT 1"'
```

Si falla con `Access denied`, probablemente el volumen se creó con otra contraseña: cambiar `.env` no cambia usuarios existentes. No borres el volumen.

## 3. Recuperar credenciales de un volumen existente

Si conoces la contraseña anterior, restaura ese valor en `DB_PASSWORD` del `.env`. Si necesitas cambiar la contraseña, entra como administrador usando las credenciales reales de MariaDB y ejecuta (reemplaza los valores, NO pegues contraseñas reales en tickets):

```sql
CREATE DATABASE IF NOT EXISTS outreach;
CREATE USER IF NOT EXISTS 'outreach'@'%' IDENTIFIED BY 'NUEVA_CLAVE';
ALTER USER 'outreach'@'%' IDENTIFIED BY 'NUEVA_CLAVE';
GRANT ALL PRIVILEGES ON outreach.* TO 'outreach'@'%';
FLUSH PRIVILEGES;
```

Actualiza `DB_PASSWORD` en `.env` para que coincida. Para conectarte como root, usa la contraseña original del volumen, que puede ser diferente de `DB_ROOT_PASSWORD` actual.

## 4. Reiniciar sin perder datos

```bash
docker compose up -d --build
curl -i http://localhost:8080/api/health
```

No ejecutes `docker compose down -v`: borra la base de datos.

Nota: el healthcheck de MariaDB solo indica que el servidor está disponible; no valida las credenciales del usuario de aplicación.
