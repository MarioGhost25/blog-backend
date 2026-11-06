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
