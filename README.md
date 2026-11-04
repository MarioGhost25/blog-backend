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
| GET | `/api/v1/categories` | No | 200, catálogo ordenado |
| GET | `/api/v1/grupos` | Sí | 200, grupos paginados |
| POST | `/api/v1/grupos` | Sí | 201, grupo y membresía de administrador |
| GET | `/api/v1/grupos/:id` | Sí | 200, detalle y rol actual |
| POST | `/api/v1/grupos/:id/miembros` | Sí | 201, membresía creada |
| DELETE | `/api/v1/grupos/:id/miembros/me` | Sí, miembro | 204, sin cuerpo |
| GET | `/api/v1/grupos/:id/miembros` | Sí, miembro | 200, miembros paginados |
| PATCH | `/api/v1/grupos/:id/miembros/:idUsuario` | Sí, administrador local o global | 200, membresía actualizada |
| DELETE | `/api/v1/grupos/:id/miembros/:idUsuario` | Sí, administrador local o global | 204, sin cuerpo |
| POST | `/api/v1/grupos/:id/transferencia` | Sí, administrador actual del grupo | 204, sin cuerpo |

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

Este mismo formato se devuelve en login y `/me`. Los nombres de propiedades estan en ingles; los valores de los enums siguen siendo los definidos en Prisma: `usuario` / `administrador` y `activo` / `suspendido`. En auth los IDs se serializan como numeros en JSON; categorías y grupos devuelven sus IDs como strings decimales para preservar la precisión de BigInt. Nunca se devuelve el hash de la contrasena.

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


## Categorías y grupos de estudio

La ruta del catálogo es `/categories` (en inglés); las de grupos son `/grupos` (en español). Todas llevan el prefijo `/api/v1`. Solo categorías es pública; grupos requiere la cookie `jwt` obtenida en login, no un Bearer token.

Los IDs de estas respuestas son strings, por ejemplo `"12"`. Envía también `idCategoria` e `idNuevoAdministrador` como strings decimales positivos para admitir todo el rango hasta `9223372036854775807`. Se aceptan números JSON únicamente si son enteros positivos seguros (hasta `Number.MAX_SAFE_INTEGER`). No conviertas los IDs de respuesta a `Number`.

### Catálogo: GET /api/v1/categories

Sin cuerpo ni parámetros. Devuelve un array con `id_categoria`, `nombre` y `descripcion` (string o null), ordenado por nombre. El resultado se conserva en caché durante una hora por instancia. Al iniciar, si la tabla está vacía, se crean Cálculo I, Programación II, Bases de Datos, Física General, Estadística e Ingeniería de Software. Usa los IDs reales del catálogo; no asumas que empiezan en 1.

### Crear: POST /api/v1/grupos

`nombre` debe tener de 3 a 100 caracteres; `descripcion` es opcional, hasta 1000 caracteres. La categoría debe existir.

```json
{
  "nombre": "Grupo de Cálculo",
  "idCategoria": "1",
  "descripcion": "Repaso de límites y derivadas"
}
```

Devuelve el grupo con `id_grupo`, `id_categoria`, `id_creador`, `nombre`, `descripcion`, `fecha_creacion`, `categoria`, `_count.miembros` y `miRol: "administrador"`. El creador ya queda inscrito: no debe llamar a unirse otra vez. No existe un endpoint de edición o eliminación del grupo.

### Listar: GET /api/v1/grupos

Todos los filtros son opcionales:

| Parámetro | Valor y comportamiento |
| --- | --- |
| `q` | Busca por nombre, sin distinguir mayúsculas. |
| `categoria` | ID decimal de la categoría. |
| `mios` | `true`: solo grupos donde perteneces. `false` u omitido: todos los grupos que cumplen los demás filtros, incluidos los tuyos. |
| `cursor` | Copia el `nextCursor` de la página anterior. |
| `limite` | Entero de 1 a 50; por defecto 30. |

Ejemplo: `GET /api/v1/grupos?q=calculo&categoria=1&mios=false&limite=10`.

La respuesta es `{ "items": [...], "nextCursor": "12" }`. Cuando no hay más resultados, `nextCursor` es null. Los grupos están ordenados por `id_grupo` descendente. Cada elemento incluye categoría, conteo de miembros y `miRol` (`miembro`, `moderador`, `administrador` o null). Para la siguiente página, conserva los filtros y agrega `cursor`; no uses un número de página.

### Detalle: GET /api/v1/grupos/:id

Sin cuerpo. Devuelve los mismos campos del grupo y `administradores`, un array con `id_usuario`, `nombre`, `apellido` y `foto_url`. No necesitas pertenecer al grupo para consultar su detalle, pero sí iniciar sesión. Si no existe, devuelve 404.

### Unirse: POST /api/v1/grupos/:id/miembros

Sin cuerpo. Inscribe al usuario de la sesión como `miembro`; no recibe un ID de otro usuario. Devuelve 201 con `id_grupo`, `id_usuario`, `rol` y `fecha_union`. Si ya perteneces, devuelve 409: `Ya eres miembro de este grupo`.

### Salir: DELETE /api/v1/grupos/:id/miembros/me

Sin cuerpo. `me` se escribe literalmente. Devuelve 204 sin cuerpo, o 404 si no tienes membresía. Si eres el único administrador, devuelve 409: `Eres el único administrador; transfiere la administración antes de salir`.

### Integrantes: GET /api/v1/grupos/:id/miembros

Requiere membresía efectiva, incluso para un administrador global. Acepta `q` (nombre, apellido o correo), `cursor` y `limite` (1–50, por defecto 30). Devuelve `{ "items": [...], "nextCursor": null }`, con cursor string cuando hay otra página, ordenado por ID de usuario descendente.

Cada elemento contiene `rol`, `fecha_union` y `usuario`. Este último incluye únicamente `id_usuario`, `nombre`, `apellido`, `correo`, `carrera` y `foto_url`. Utiliza `usuario.id_usuario` como `:idUsuario` en las operaciones siguientes.

### Cambiar rol: PATCH /api/v1/grupos/:id/miembros/:idUsuario

Requiere administrador del grupo o global. Cuerpo:

```json
{ "rol": "moderador" }
```

Valores válidos: `miembro`, `moderador`, `administrador`. Devuelve 200 con la membresía actualizada. Un moderador no puede cambiar roles ni expulsar integrantes. Devuelve 404 si el integrante no existe y 409 si intentas degradar al último administrador.

### Expulsar: DELETE /api/v1/grupos/:id/miembros/:idUsuario

Sin cuerpo. Requiere administrador del grupo o global. Devuelve 204 sin cuerpo. No permite expulsar al último administrador, ni siquiera a uno mismo: devuelve 409, `El grupo no puede quedar sin administrador`.

### Transferir: POST /api/v1/grupos/:id/transferencia

```json
{
  "idNuevoAdministrador": "2",
  "salir": false
}
```

El destinatario debe ser otro miembro del grupo. `salir` es obligatorio y debe ser booleano, no el string `"false"`. Con false, el administrador actual queda como miembro; con true, sale del grupo. Devuelve 204 sin cuerpo. Transferirse a uno mismo o a un usuario sin membresía devuelve 400. Un administrador global que no sea administrador actual de ese grupo no puede transferir: recibe 403.

### Prueba completa desde PowerShell

Inicia primero el backend. Ejecuta estos bloques en orden en la misma terminal PowerShell. Ajusta el puerto al de tu servidor; para Heroku, usa `https://TU-APP.herokuapp.com/api/v1`. Las sesiones guardan las cookies en memoria. También puedes usar Postman: haz login y conserva su cookie jar para el mismo host.

Estos ejemplos crean dos cuentas y un grupo persistentes en la base configurada. Utiliza una base de desarrollo para esta prueba manual; no hay endpoint para borrar el grupo.

```powershell
$base = 'http://localhost:4000/api/v1'
$suffix = [guid]::NewGuid().ToString('N')
$emailAdmin = "admin-$suffix@example.com"
$emailMiembro = "miembro-$suffix@example.com"
$passwordPrueba = 'ExamplePassword123!'

# Registrar dos cuentas; el registro no inicia sesión.
foreach ($email in @($emailAdmin, $emailMiembro)) {
  $body = @{ firstName = 'Usuario'; lastName = 'Prueba'; email = $email; password = $passwordPrueba } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri "$base/auth/register" -ContentType 'application/json' -Body $body
}

# Dos sesiones independientes: cada una conserva su propia cookie jwt.
$body = @{ email = $emailAdmin; password = $passwordPrueba } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body $body -SessionVariable sesionAdmin
$body = @{ email = $emailMiembro; password = $passwordPrueba } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body $body -SessionVariable sesionMiembro

# GET categories: público. Elegir un ID real.
$categorias = Invoke-RestMethod -Uri "$base/categories"
$categorias | Format-Table
$idCategoria = [string]$categorias[0].id_categoria

# POST grupos: el creador queda como administrador.
$body = @{ nombre = 'Grupo de prueba'; idCategoria = $idCategoria; descripcion = 'Ejemplo desde PowerShell' } | ConvertTo-Json
$grupo = Invoke-RestMethod -Method Post -Uri "$base/grupos" -WebSession $sesionAdmin -ContentType 'application/json' -Body $body
$idGrupo = [string]$grupo.id_grupo
$grupo | ConvertTo-Json -Depth 6

# GET listado y detalle.
$pagina = Invoke-RestMethod -Uri "$base/grupos?categoria=$idCategoria&mios=false&limite=10" -WebSession $sesionAdmin
$pagina | ConvertTo-Json -Depth 6
if ($pagina.nextCursor) {
  Invoke-RestMethod -Uri "$base/grupos?categoria=$idCategoria&mios=false&limite=10&cursor=$($pagina.nextCursor)" -WebSession $sesionAdmin
}
Invoke-RestMethod -Uri "$base/grupos/$idGrupo" -WebSession $sesionAdmin

# POST miembros: la segunda cuenta se une. Guardar su ID exacto.
$membresia = Invoke-RestMethod -Method Post -Uri "$base/grupos/$idGrupo/miembros" -WebSession $sesionMiembro
$idMiembro = [string]$membresia.id_usuario

# GET miembros y PATCH rol.
Invoke-RestMethod -Uri "$base/grupos/$idGrupo/miembros?limite=30" -WebSession $sesionAdmin
$body = @{ rol = 'moderador' } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "$base/grupos/$idGrupo/miembros/$idMiembro" -WebSession $sesionAdmin -ContentType 'application/json' -Body $body

# DELETE miembro: expulsar a la segunda cuenta (204).
Invoke-RestMethod -Method Delete -Uri "$base/grupos/$idGrupo/miembros/$idMiembro" -WebSession $sesionAdmin

# Volver a unirse para probar la transferencia.
Invoke-RestMethod -Method Post -Uri "$base/grupos/$idGrupo/miembros" -WebSession $sesionMiembro

# POST transferencia: la segunda cuenta pasa a administrar; la primera queda como miembro (204).
$body = @{ idNuevoAdministrador = $idMiembro; salir = $false } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$base/grupos/$idGrupo/transferencia" -WebSession $sesionAdmin -ContentType 'application/json' -Body $body

# DELETE me: la primera cuenta ya puede salir; queda la segunda como administrador (204).
Invoke-RestMethod -Method Delete -Uri "$base/grupos/$idGrupo/miembros/me" -WebSession $sesionAdmin
Invoke-RestMethod -Uri "$base/grupos/$idGrupo" -WebSession $sesionMiembro
```

Las operaciones 204 no imprimen JSON. Los errores HTTP hacen que `Invoke-RestMethod` lance una excepción; consulta el cuerpo de error en la terminal o en Postman.

### Errores que puedes comprobar

| Prueba | Resultado esperado |
| --- | --- |
| Consultar grupos sin cookie válida | 401 |
| Crear grupo con nombre de 2 caracteres, ID inválido o campos adicionales | 400 |
| Usar `mios=otro` o `limite=51` | 400 |
| Crear grupo con categoría inexistente | 404 |
| Unirse dos veces al mismo grupo | 409 |
| Consultar integrantes sin membresía | 403 |
| Cambiar roles o expulsar como miembro/moderador | 403 |
| Salir, degradar o expulsar al único administrador | 409 |
| Transferir a uno mismo o a un usuario que no pertenece al grupo | 400 |

### Pruebas automatizadas de categorías y grupos

```powershell
npm.cmd run build
npm.cmd test -- --runInBand categories groups
```

Estas suites usan dobles de base de datos. La verificación opcional siguiente conecta con la base configurada: ejecuta el seed normal de categorías y revierte los usuarios, grupos y membresías de prueba al finalizar. Requiere haber compilado y tener acceso a PostgreSQL.

```powershell
$env:RUN_REMOTE_SMOKE = '1'
try {
  node src/groups/verification/remote-smoke.cjs
} finally {
  Remove-Item Env:RUN_REMOTE_SMOKE -ErrorAction SilentlyContinue
}
```

## Compilar

```bash
npm run build
```
