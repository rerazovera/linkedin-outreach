# Corrección de serialización BigInt

Esta versión corrige el error `Do not know how to serialize a BigInt` en las respuestas JSON de Express.

MariaDB puede devolver `BIGINT` en identificadores y resultados. El serializador JSON ahora convierte los enteros seguros a números y los grandes a texto para evitar pérdida de precisión.

## Actualización en Dokploy

Sube estos archivos al repositorio GitHub, mantén tus variables privadas configuradas en Dokploy y despliega nuevamente el Docker Compose. No borres el volumen de MariaDB.

Para comprobar el funcionamiento, inicia sesión, consulta contactos, importa `Invitations.csv` y revisa el historial de envíos.

No se incluyen archivos `.env` ni credenciales.
