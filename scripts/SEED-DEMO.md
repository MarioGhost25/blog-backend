# Seed de demostración: local y Heroku

La seed es manual. No se ejecuta durante build, release ni arranque. No cambia modelos ni aplica migraciones.

## Heroku: misma base de la aplicación

1. Desplegar `package.json` y `scripts/seed-demo.cjs` del backend. La aplicación debe tener sus migraciones actuales aplicadas y Prisma Client generado por el build normal.
2. En Heroku > aplicación BACKEND > Settings > Reveal Config Vars configurar:

| Variable | Valor |
| --- | --- |
| DEMO_SEED_CONFIRM | heroku-demo |
| DEMO_PASSWORD | Una contraseña nueva y privada de 12 caracteres o más, con mayúscula, minúscula y número; máximo 72 bytes. |
| DATABASE_URL | Conservar el valor existente del complemento PostgreSQL. No cambiarlo. |

No configurar DEMO_DATABASE_URL en Heroku. DYNO lo proporciona Heroku automáticamente. No subir .env ni contraseñas al repositorio.

3. Desde una terminal con Heroku CLI autenticada, sustituir NOMBRE_APP_BACKEND por el nombre de la aplicación (no su URL ni el nombre de la base):

```sh
heroku run -a NOMBRE_APP_BACKEND "npm run seed:demo -- --heroku --check"
heroku run -a NOMBRE_APP_BACKEND "npm run seed:demo -- --heroku"
```

El primer comando solo valida configuración; no comprueba conectividad, permisos ni esquema. El segundo inserta datos en DATABASE_URL. Esperar el mensaje `Demo ready`. Si la operación falla, la transacción revierte las inserciones de esa ejecución.

4. Abrir la aplicación y comprobar los datos. Las cinco cuentas son `astra.demo.1@example.test` hasta `astra.demo.5@example.test`. Las nuevas usan DEMO_PASSWORD. La quinta cuenta es administradora global: no publicar esa contraseña ni usarla como credencial real.
5. Al terminar, eliminar DEMO_PASSWORD y DEMO_SEED_CONFIRM de Config Vars. Los datos permanecen en PostgreSQL. Esto no deshabilita las cuentas creadas ni cambia sus contraseñas.

Se crean cinco usuarios ficticios, tres categorías, tres grupos, doce publicaciones (una retenida), once comentarios y once respuestas, once avisos. Sin imágenes ni cargas a Cloudinary. No elimina registros existentes. Al repetir, reutiliza los registros de demostración encontrados y no cambia contraseñas existentes. No modificar los identificadores naturales de los datos demo si se pretende repetir la seed sin recrear registros renombrados.

Si una cuenta con un correo reservado existe sin el marcador del seed, aborta sin modificarla. El bloqueo transaccional evita dos ejecuciones simultáneas del seed. La opción --heroku requiere un dyno temporal run.*, la confirmación indicada y usa únicamente DATABASE_URL.

## Local

Configurar DEMO_DATABASE_URL con una base PostgreSQL local migrada cuyo nombre termine en _demo o _test, DEMO_SEED_CONFIRM=local-demo y DEMO_PASSWORD. Ejecutar `npm run seed:demo`. No lee .env automáticamente.

## Verificación realizada

Sintaxis y validaciones de configuración comprobadas sin conexión. No se ejecutó esta seed en Heroku ni en una base real durante su preparación.

Referencia: https://devcenter.heroku.com/articles/working-with-one-off-dynos