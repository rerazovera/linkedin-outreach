# Dokploy — instalación limpia y diagnóstico

## Instalación NUEVA (sin datos previos)

1. En Dokploy cree una aplicación **Docker Compose** y cargue TODOS los archivos de este ZIP, incluido `.env` si el método de carga lo admite. El compose también incluye valores predeterminados generados para funcionar cuando Dokploy no carga `.env`.
2. No configure variables DB_PASSWORD, DB_ROOT_PASSWORD o JWT_SECRET antiguas en Dokploy: las variables de entorno de Dokploy tienen prioridad sobre los valores del ZIP. Si existen, elimínelas o hágalas coincidir con `.env`.
3. Despliegue. Configure el dominio apuntando al servicio `web`, puerto interno **80** (o publique 8080).
4. Revise `https://SU_DOMINIO/api/health`: debe responder JSON con `database: connected`.
5. El usuario de acceso inicial es `admin`; la contraseña está en `ADMIN_PASSWORD` del archivo `.env` de este ZIP. Cámbiela de forma segura antes de exponer la aplicación.
6. Para habilitar Brevo configure BREVO_API_KEY, BREVO_SENDER_EMAIL (remitente verificado) y BREVO_SENDER_NAME en el entorno del compose y redepliegue.

## IMPORTANTE: si ya desplegó versiones anteriores

Un ZIP nuevo NO cambia la contraseña almacenada en un volumen MariaDB existente. No elimine el volumen si tiene contactos o envíos. En su lugar, use la contraseña SQL original o recupere el acceso con copia de seguridad. Si desea empezar completamente desde cero y NO necesita los datos, elimine el volumen de MariaDB desde Dokploy después de confirmar la pérdida de datos y cree una nueva instalación. No es necesario borrar volúmenes para solucionar el healthcheck.

## Si `db` sigue unhealthy

Revise logs del contenedor `db` en Dokploy. `mariadb-admin ping` prueba que el servidor escucha; el backend seguirá reintentando si las credenciales no son válidas. No use `docker compose down -v` con datos importantes.

## Limitaciones

El estado `sent` significa aceptación por la API de Brevo, no entrega final. La cola reintenta errores transitorios hasta 24 h; no evita duplicados en el caso extremo de caída después de la aceptación de Brevo y antes de registrar el resultado.
