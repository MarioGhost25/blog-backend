# Blog Backend

API REST con NestJS, Prisma y PostgreSQL. Autenticacion mediante una cookie HttpOnly llamada `jwt`.

## Arranque local

```bash
npm install
npm run start:dev
```

Necesitas PostgreSQL disponible y las variables de conexion de tu `.env` configuradas: `DATABASE_URL`, `DB_USERNAME`, `DB_NAME`, `DB_PASSWORD` y `PG_PORT`. Tambien se requiere `JWT_SECRET`.

Para trabajar con el frontend, configura estas variables en `.env`:

```dotenv
NODE_ENV=development
PORT=4000
FRONTEND_URL=http://localhost:3000
```

Los ejemplos usan `http://localhost:4000/api/v1`. Sustituye `4000` por el valor real de `PORT` en tu `.env`. Si `PORT` no esta definido, Joi aplica `2000`. Reinicia el backend tras modificar `.env`; el watcher de TypeScript no garantiza recargar ese archivo.

`FRONTEND_URL` debe coincidir con el origen del frontend, incluido su puerto. Usa `localhost` de forma consistente: no mezcles `localhost` y `127.0.0.1`.

## Despliegue en Heroku

El archivo `Procfile` debe llamarse exactamente `Procfile`, sin extension y con la `P` en mayuscula. Su contenido inicia la version compilada de Nest:

```text
web: npm run start:prod
```

Heroku ejecuta `npm run build` durante el despliegue porque existe ese script en `package.json`. Configura en Heroku al menos `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL` y `NODE_ENV=production` como variables de configuracion. Si agregas Heroku Postgres, `DATABASE_URL` se crea automaticamente.

Antes de iniciar la aplicacion, aplica las migraciones de produccion desde la consola de Heroku:

```bash
npx prisma migrate deploy
```

No uses `.env` en Heroku; las variables se configuran en `Settings > Config Vars`.

## Endpoints disponibles

Todas las rutas incluyen el prefijo `/api/v1`.

| Metodo | Ruta | Requiere sesion | Respuesta correcta |
| --- | --- | --- | --- |
| GET | `/api/v1` | No | 200, texto `Hello World!` |
| POST | `/api/v1/auth/register` | No | 201, perfil publico |
| POST | `/api/v1/auth/login` | No | 200, perfil publico y cookie `jwt` |
| POST | `/api/v1/auth/logout` | No | 204, sin cuerpo; elimina la cookie |
| GET | `/api/v1/auth/me` | Si, cookie `jwt` | 200, perfil publico |
| POST | `/api/v1/auth/forgot-password` | No | 202, mensaje generico |
| POST | `/api/v1/auth/reset-password` | No | 204, sin cuerpo |

Los POST con cuerpo esperan `Content-Type: application/json`. Los campos adicionales a los DTOs se rechazan con 400.

## Registro

`POST /api/v1/auth/register`

```json
{
  "firstName": "Ana",
  "lastName": "Perez",
  "email": "ana@example.com",
  "password": "ExamplePassword123!"
}
```

- `firstName` y `lastName`: entre 2 y 80 caracteres.
- `email`: correo valido, hasta 254 caracteres. Se almacena en minusculas.
- `password`: de 8 a 72 caracteres, con mayuscula, numero y simbolo; no puede superar 72 bytes UTF-8.
- 409 si el correo ya esta registrado; 400 si los datos no son validos.
- No inicia sesion automaticamente ni establece una cookie.

Respuesta 201 (ejemplo):

```json
{
  "id": 1,
  "firstName": "Ana",
  "lastName": "Perez",
  "email": "ana@example.com",
  "role": "usuario",
  "status": "activo",
  "photoUrl": null
}
```

Este mismo formato se devuelve en login y `/me`. Los nombres de propiedades estan en ingles; los valores de los enums siguen siendo los definidos en Prisma: `usuario` / `administrador` y `activo` / `suspendido`. Actualmente los IDs se serializan como numeros en JSON. Nunca se devuelve el hash de la contrasena.

## Login

`POST /api/v1/auth/login`

```json
{
  "email": "ana@example.com",
  "password": "ExamplePassword123!"
}
```

Devuelve 200 con el perfil y establece la cookie `jwt` durante una hora. El JWT no se devuelve en el JSON.

- 401: credenciales incorrectas.
- 403: cuenta suspendida, despues de verificar la contrasena.
- 400: cuerpo invalido.

## Perfil actual

`GET /api/v1/auth/me`

Sin cuerpo. El navegador debe enviar la cookie con `credentials: 'include'`.

Devuelve 200 con el perfil. Devuelve 401 si falta la cookie, el JWT no es valido, ha expirado o el usuario ya no existe; 403 si la cuenta esta suspendida.

No se admite `Authorization: Bearer` como alternativa a la cookie.

## Logout

`POST /api/v1/auth/logout`

Sin cuerpo. Devuelve 204 y elimina la cookie; no intentes leer JSON de esta respuesta. Utiliza `credentials: 'include'`.

Elimina la cookie del navegador, pero no revoca copias del JWT que pudieran existir.

## Solicitar recuperacion de contrasena

`POST /api/v1/auth/forgot-password`

```json
{
  "email": "ana@example.com"
}
```

Respuesta 202:

```json
{
  "message": "If the account exists, password reset instructions will be provided."
}
```

La respuesta es igual para correos existentes e inexistentes. No requiere cookie ni devuelve el token.

Para una cuenta existente, se invalidan los tokens anteriores y se genera uno nuevo con vigencia de 30 minutos. La BD guarda solamente su hash SHA-256.

### Obtener el token en desarrollo

1. Asegurate de tener `NODE_ENV=development` en `.env`.
2. Reinicia `npm run start:dev` si acabas de cambiar esa variable.
3. Solicita recuperacion con un correo que ya hayas registrado.
4. Mira la terminal donde se ejecuta Nest, no la consola del navegador.
5. Copia el valor que aparece despues de:

```text
[AuthService] Password reset token (development only):
```

El token real tiene 43 caracteres. No copies el prefijo del mensaje, ni el hash de la BD, ni el JWT de la cookie.

Si el correo no existe, no se genera ni se imprime un token, aunque la respuesta sea 202. Si haces otra solicitud, utiliza el ultimo token generado.

El envio de correo todavia no esta implementado. En produccion el token no se imprime: configura `NODE_ENV=production` y conecta un servicio de correo antes de ofrecer recuperacion a usuarios reales.

## Restablecer contrasena

`POST /api/v1/auth/reset-password`

```json
{
  "token": "REEMPLAZAR_POR_EL_TOKEN_REAL_DE_43_CARACTERES",
  "newPassword": "NewExamplePassword456!"
}
```

El texto de ejemplo de `token` debe reemplazarse por el token real de la terminal.

- `token`: string de exactamente 43 caracteres.
- `newPassword`: las mismas reglas de seguridad que la contrasena de registro.
- 204: contrasena actualizada y token consumido, sin cuerpo.
- 400: token ausente, longitud incorrecta o contrasena invalida.
- 410: token inexistente, expirado, invalidado o ya utilizado.

No requiere una sesion iniciada. El token de recuperacion se envia en el JSON, no en una cookie. Despues, haz login con la nueva contrasena. Restablecerla no inicia sesion ni invalida automaticamente los JWT emitidos previamente.



El helper anterior se usa para los endpoints JSON de auth; la ruta raiz devuelve texto.

El navegador gestiona la cookie automaticamente. Al ser HttpOnly, no puedes leerla con `document.cookie` y no necesitas guardar el JWT en localStorage.

La cookie usa `SameSite=Strict`, `Path=/` y `Secure` cuando `NODE_ENV=production`. Para cookies entre origenes distintos, frontend y API deben pertenecer al mismo sitio; habilitar CORS no permite enviar esta cookie entre sitios distintos. En local puedes usar `http://localhost:3000` y `http://localhost:4000`.

## Secuencia sugerida para integrar el frontend

1. Crear una cuenta con `register`.
2. Iniciar sesion con `login`.
3. Recuperar el perfil mediante `me`, tambien al recargar la pagina.
4. Cerrar sesion con `logout`.
5. Solicitar recuperacion con `forgot-password`.
6. Copiar el token de la terminal y enviarlo con `newPassword` a `reset-password`.
7. Iniciar sesion con la nueva contrasena.

## Compilar

```bash
npm run build
```
