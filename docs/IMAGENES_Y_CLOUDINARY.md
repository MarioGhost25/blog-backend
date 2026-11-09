# Imágenes de perfil y publicaciones

## Diagnóstico local del 8 de noviembre de 2026

El frontend consulta Nest en localhost:2000. Tanto `blog-backend/.env` como el
contenedor `blog-backend-backend-1` carecían de `CLOUDINARY_CLOUD_NAME`,
`CLOUDINARY_API_KEY` y `CLOUDINARY_API_SECRET`. Se comprobó únicamente su presencia,
sin imprimir valores. El error genérico de foto ocultaba esta falta de configuración.

El servicio ahora distingue:

- 503 / `MediaStorageNotConfigured`: falta configuración; no intenta la subida.
- 502 / `MediaStorageUnavailable`: el proveedor no pudo guardar la imagen.

Next traduce únicamente esos códigos conocidos. Nunca reenvía mensajes del
proveedor, credenciales o IDs internos al navegador. Los fallos conservan sesión
y los datos persistidos; el flujo de perfil mantiene su compensación si falla la BD.

## Configuración necesaria

Completar localmente `blog-backend/.env`, sin publicar sus valores:

```dotenv
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

Las tres variables deben pertenecer al mismo entorno de Cloudinary. Se obtienen
en Console → Settings → API Keys. Este proyecto usa esas tres variables explícitas;
no basta con configurar únicamente CLOUDINARY_URL. Las claves no van en el frontend.
Referencia oficial: [configuración del SDK Node](https://cloudinary.com/documentation/node_integration).

Después hay que cargar el código/configuración nuevos en el proceso backend y
reiniciar el frontend si sirve una compilación anterior. `docker compose restart`
no incorpora variables nuevas de env_file a un contenedor ya creado.

**Antes de recrear el backend Docker:** su Dockerfile actual ejecuta `prisma migrate
deploy` al arrancar. Rehacer el contenedor también puede aplicar las migraciones
pendientes; no es equivalente a reiniciar únicamente el servidor. Revisar el plan
de migraciones y las variables SMTP exigidas en NODE_ENV=production. En esta
corrección no se recreó ese contenedor ni se ejecutaron migraciones sobre su BD.

## Uso de imágenes en publicaciones públicas

1. Crear y guardar la publicación; se abre su detalle.
2. En **Imágenes**, seleccionar un JPG/PNG de hasta 4 MiB (mostrado como 4 MB).
3. Escribir la descripción y pulsar **Subir imagen**.
4. La imagen aparece en el detalle. El autor puede eliminarla con confirmación.

La publicación y sus imágenes se guardan por separado. Si falla la subida,
la publicación permanece disponible. Si no se pudo confirmar el resultado, recargar
los recursos antes de repetir la operación evita reintentar a ciegas. No hay
reintentos automáticos ni doble envío durante una operación pendiente.

Rutas: POST /api/posts/:id/attachments → POST /api/v1/posts/:id/attachments
(multipart file/title; el BFF fija type=image). DELETE /api/posts/:id/attachments/:aid
→ DELETE equivalente en Nest (204). Origin, cookie, límites de cuerpo y lista
blanca se verifican en Next; Nest aplica la autorización de autor y los límites
finales. El BFF de publicaciones rechaza esta gestión para contenido de grupos.

Se reutiliza la lectura acotada del flujo de foto, incluida la sobrecarga multipart.
El adaptador de respuesta elimina cloudinaryPublicId. Las imágenes se muestran
con su descripción, tamaño adaptable y enlace al original.

## Alcance pendiente y pruebas

A01 sigue parcial: PDF/enlaces desde UI, reordenamiento y compresión aún pendientes.
A02 sigue pendiente: validación por decodificación/firma en el servidor antes del
proveedor, entrega privada revocable, consistencia externa y pruebas de carga.
La UI actual no habilita subir archivos privados de grupos.

Las pruebas de navegador recorren foto y publicación con Next, Nest y PostgreSQL
reales, pero **Cloudinary se sustituye por un stub local** (`test/media-storage-stub.cjs`).
Solo puede precargarse explícitamente con NODE_ENV=test y una bandera de prueba;
la aplicación no lo importa. Un servidor local entrega una imagen PNG sintética.
Se verifica subida/visualización/eliminación, persistencia de perfil, campos privados
filtrados y conservación de la publicación tras un fallo de almacenamiento.

La integración HTTP independiente comprueba el 503 sin configuración y que no
cambia la foto anterior. La entrega a Cloudinary real no está verificada hasta
configurar credenciales y probarla con autorización sobre ese entorno.
