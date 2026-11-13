# Desarrollo local con Docker

1. Copia `.env.template` a `.env` si todavía no existe.
2. Completa `DB_USERNAME`, `DB_NAME`, `DB_PASSWORD`, `PG_PORT` (5432),
   `JWT_SECRET` (un secreto aleatorio) y `PORT` (2000). Usa una contraseña
   hexadecimal o alfanumérica para que funcione en la URL de conexión.
   Para ejecutar Nest fuera de Docker, configura también `DATABASE_URL` con
   host `localhost`; Compose configura automáticamente el host `postgres-db`.
3. Ejecuta `docker compose up -d --build`.
4. Verifica `curl http://localhost:2000/api/v1` y `docker compose ps`.

El backend aplica las migraciones existentes antes de iniciar. PostgreSQL 18
conserva los datos en el volumen `postgres_data`. La API y la base de datos
se publican únicamente en localhost.

- Logs: `docker compose logs -f backend`.
- Detener conservando los datos: `docker compose down`.
- Reconstruir después de modificar código: `docker compose up -d --build`.

Configura las variables `CLOUDINARY_*` para subir imágenes o documentos.
Sin ellas puedes iniciar la API, pero las cargas de archivos no funcionarán.
No compartas ni subas `.env` al repositorio.

# API Endpoints

Para enviar correos de recuperación, configura `MAILER_SERVICE` (nombre del
proveedor reconocido por Nodemailer, por ejemplo `gmail`), `MAILER_EMAIL`
(correo remitente) y `MAILER_SECRET_KEY` (credencial SMTP del proveedor).
Agrega `RECOVERY_URL` con la URL de la página de recuperación del frontend,
por ejemplo `http://localhost:3000/recuperar`; en producción debe usar HTTPS.
El servicio agrega `/<token>` a esa URL. Las variables `SMTP_*` siguen
disponibles como alternativa; si defines `MAILER_SERVICE`, se usa ese proveedor.

Para comprobar conexión y credenciales sin enviar correo ni acceder a la base,
ejecuta `npm run mail:check`. Para probar la recuperación completa, inicia backend
y frontend, abre `http://localhost:3000/recuperar` e ingresa el correo de una
cuenta registrada. Revisa la bandeja y spam, abre el enlace y define la nueva
contraseña. La respuesta HTTP 202 es genérica y no confirma que se haya enviado
un correo. La comprobación SMTP tampoco garantiza la llegada a la bandeja.

## General

| Metodo | Endpoint | Descripcion |
| --- | --- | --- |
| GET | `/api/v1` | Comprobar que la API responde |

## Auth

| Metodo | Endpoint | Descripcion |
| --- | --- | --- |
| POST | `/api/v1/auth/register` | Registrar una cuenta |
| POST | `/api/v1/auth/login` | Iniciar sesion |
| POST | `/api/v1/auth/logout` | Cerrar sesion |
| POST | `/api/v1/auth/forgot-password` | Solicitar recuperacion de contrasena |
| POST | `/api/v1/auth/reset-password` | Restablecer la contrasena |
| GET | `/api/v1/auth/me` | Consultar los datos basicos de la sesion |

## Users

| Metodo | Endpoint | Descripcion |
| --- | --- | --- |
| GET | `/api/v1/users/me` | Consultar mi perfil completo |
| PATCH | `/api/v1/users/me` | Actualizar mis datos de perfil |
| PUT | `/api/v1/users/me/photo` | Subir o reemplazar mi foto de perfil |
| GET | `/api/v1/users/me/posts` | Listar mis publicaciones |
| GET | `/api/v1/users/:id` | Consultar un perfil publico |

## Categories

| Metodo | Endpoint | Descripcion |
| --- | --- | --- |
| GET | `/api/v1/categories` | Listar las categorias |

## Groups

| Metodo | Endpoint | Descripcion |
| --- | --- | --- |
| POST | `/api/v1/groups` | Crear un grupo |
| GET | `/api/v1/groups` | Listar y filtrar grupos |
| GET | `/api/v1/groups/:id` | Consultar el detalle de un grupo |
| POST | `/api/v1/groups/:id/members` | Unirme al grupo |
| DELETE | `/api/v1/groups/:id/members/me` | Salir del grupo |
| GET | `/api/v1/groups/:id/members` | Listar los integrantes del grupo |
| PATCH | `/api/v1/groups/:id/members/:userId` | Cambiar el rol de un integrante |
| DELETE | `/api/v1/groups/:id/members/:userId` | Expulsar a un integrante |
| POST | `/api/v1/groups/:id/transfer` | Transferir la administracion del grupo |

Gestión de roles, expulsión y transferencia exigen administración **local** vigente,
revalidada bajo lock. El rol global administrador conserva moderación de contenido;
no permite gestionar integrantes sin ese rol local. Listar integrantes exige
membresía y solo permite buscar por nombre/apellido, sin seleccionar ni exponer correo.
Las salidas/degradaciones/expulsiones no pueden dejar al grupo sin administrador.
Nombres de grupo se normalizan antes de validar 3–100 caracteres; búsquedas ≤254.
La [matriz G02 y sus pruebas](../docs/ENTREGA_G02_2026-11-09.md) documentan los criterios
D01/D02 adoptados y sus límites. El BFF y la interfaz de grupos son el siguiente módulo.

## Posts

| Metodo | Endpoint | Descripcion |
| --- | --- | --- |
| POST | `/api/v1/posts` | Crear una publicacion |
| GET | `/api/v1/posts` | Listar publicaciones publicas visibles |
| GET | `/api/v1/posts/search` | Buscar publicaciones publicas visibles |
| GET | `/api/v1/posts/group/:groupId` | Listar publicaciones visibles de un grupo |
| GET | `/api/v1/posts/:id` | Consultar una publicacion y sus adjuntos |
| PATCH | `/api/v1/posts/:id` | Actualizar una publicacion |
| DELETE | `/api/v1/posts/:id` | Eliminar una publicacion |

## Attachments

| Metodo | Endpoint | Descripcion |
| --- | --- | --- |
| POST | `/api/v1/posts/:id/attachments` | Agregar una imagen, PDF o enlace a la publicacion |
| PATCH | `/api/v1/posts/:id/attachments/order` | Cambiar el orden de los adjuntos de esa publicacion |
| DELETE | `/api/v1/posts/:id/attachments/:attachmentId` | Eliminar un adjunto de la publicacion |

Escrituras grupales y adjuntos revalidan membresía dentro de la transacción en orden
grupo → publicación → dependientes. La subida externa ocurre antes de esa transacción
y se compensa si se perdió acceso. La eliminación externa ocurre después de confirmar
la desvinculación en BD; un 502 puede dejar el archivo huérfano y el adjunto ya retirado.
La limpieza durable y la entrega privada revocable siguen pendientes en A02.

Tras salir/ser expulsado, el autor común pierde lectura, edición, adjuntos y eliminación
propia grupal. Propias y su contador excluyen grupos inaccesibles; el contador público
solo incluye publicaciones públicas visibles. Ver [contrato completo](../docs/contratos-api.md).

## Seguridad HTTP y proxy

Límites globales/auth/búsqueda, firma de identidad del BFF, errores con correlación y auditoría HTTP: [configuración y límites operativos](docs/SEGURIDAD_Y_PROXY.md). El store actual es de una sola instancia. Activar la fuente de IP requiere verificar el proxy real; no confiar en cabeceras enviadas directamente por el navegador. Producción exige JWT_SECRET de al menos 32 caracteres.


## Publicaciones y grupos — revisión del 10/11/2026

La entrega integra grupos/integrantes/muro, publicación grupal, imagen/PDF/enlace privados nuevos, conversación, tiempo real, moderación y notificaciones. Ver [alcance y evidencia](../docs/AVANCE_PUBLICACIONES_GRUPOS_2026-11-10.md), [contratos actuales](../docs/contratos-api.md) y [migraciones/proxy/operación](../docs/OPERACION_PUBLICACIONES_GRUPOS.md). La configuración real y los recursos públicos heredados requieren los pasos operativos de esa guía. El panel global AD01 sigue pendiente.

Contrato C01 y pruebas contra respuestas HTTP sintéticas: [documentación](docs/contracts/README.md).
