#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo 'Docker no encontrado'; exit 1; }
command -v python3 >/dev/null || { echo 'Python3 no encontrado'; exit 1; }
# docker compose config resuelve las variables del mismo .env que utiliza la API.
CONFIG="$(docker compose config --format json)"
readarray -t VALORES < <(printf '%s' "$CONFIG" | python3 -c 'import json,sys; d=json.load(sys.stdin)["services"]["api"]["environment"]; print(d["DB_USER"]);print(d["DB_PASSWORD"]);print(d["DB_NAME"])')
DB_USER="${VALORES[0]}"; DB_PASSWORD="${VALORES[1]}"; DB_NAME="${VALORES[2]}"
if [[ -z "$DB_USER" || -z "$DB_PASSWORD" || -z "$DB_NAME" ]]; then echo 'Variables DB incompletas'; exit 1; fi
printf 'Se actualizará el usuario MariaDB %s para la base %s, sin borrar datos.\n' "$DB_USER" "$DB_NAME"
read -r -p '¿Continuar? [s/N] ' CONFIRM
[[ "$CONFIRM" == s || "$CONFIRM" == S ]] || exit 0
# Escapar identificadores y cadenas SQL; la contraseña nunca se muestra en pantalla.
SQL="$(DB_USER="$DB_USER" DB_PASSWORD="$DB_PASSWORD" DB_NAME="$DB_NAME" python3 - <<'PY'
import os
user=os.environ['DB_USER'].replace('\\','\\\\').replace("'","''")
pwd=os.environ['DB_PASSWORD'].replace('\\','\\\\').replace("'","''")
db=os.environ['DB_NAME'].replace('`','``')
print(f"CREATE USER IF NOT EXISTS '{user}'@'%' IDENTIFIED BY '{pwd}';")
print(f"ALTER USER '{user}'@'%' IDENTIFIED BY '{pwd}';")
print(f"GRANT ALL PRIVILEGES ON `{db}`.* TO '{user}'@'%';")
PY
)"
echo 'Se solicitará la contraseña ROOT ACTUAL de MariaDB (puede ser distinta de DB_ROOT_PASSWORD en .env).'
printf '%s\n' "$SQL" | docker compose exec -T db mariadb -uroot -p
printf 'Credenciales actualizadas. Reiniciando API...\n'
docker compose restart api
printf 'Revisa: docker compose logs --tail=30 api\n'
