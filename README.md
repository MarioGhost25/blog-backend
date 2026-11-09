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
