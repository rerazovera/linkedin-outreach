# Importación de LinkedIn (formato exacto de Invitations.csv)

En la aplicación, abre **Importar Invitations.csv de LinkedIn** y selecciona el CSV descargado, sin cambiar columnas.

Columnas: `From`, `To`, `Sent At`, `Message`, `Direction`, `inviterProfileUrl`, `inviteeProfileUrl`.

- `OUTGOING`: contacto = `To`, perfil = `inviteeProfileUrl`.
- `INCOMING`: contacto = `From`, perfil = `inviterProfileUrl`.
- Duplicados: se identifican por URL de perfil; reimportar no duplica.
- Conserva el correo existente; Invitations.csv **no contiene correo electrónico**.
- También acepta `Connections.csv` con `First Name`, `Last Name`, `URL` y `Email Address` para completar correos cuando coincida el perfil.
- Las invitaciones no implican necesariamente conexiones aceptadas.

## Dokploy

Crea las variables del archivo `.env.example` en **Environment** de Dokploy, usando valores reales y secretos nuevos. No publiques `.env` ni el directorio `.git` en GitHub. Mantén el volumen de MariaDB al actualizar. La clave Brevo debe configurarse en Dokploy.
