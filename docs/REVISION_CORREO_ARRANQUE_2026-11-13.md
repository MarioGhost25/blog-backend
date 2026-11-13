# Revisión de correo y arranque — 13/11/2026

**Dictamen: no listo para el merge completo solicitado.** El backend supera las
verificaciones indicadas; falta integrar y aprobar el recorrido del frontend.
No se realizó merge, commit ni modificación de contraseñas reales.

## Resultado histórico comunicado por el solicitante

Estos resultados no se usaron como evidencia de la ejecución actual:

| Comprobación | Resultado histórico |
| --- | --- |
| `npm run mail:check` con Gmail | Conexión/autenticación aprobadas; entrega no comprobada |
| Joi / configuración de correo / ciclo de Realtime | 8 / 4 / 1 pruebas aprobadas |
| Generación Prisma y `npm run build` | Aprobadas |
| `npm run start:dev` y `GET http://localhost:4000/api/v1` | Sin errores de compilación; HTTP 200 |
| Prisma/PostgreSQL y tabla `categoria` | Aprobadas |
| ESLint de correo/configuración | Aprobado; tres errores conocidos en Realtime |

## Ejecución actual

| Comprobación | Comando o procedimiento | Resultado y bloqueo |
| --- | --- | --- |
| Diff completo, archivos nuevos, índice y secretos | `git diff`, `git diff --cached --stat`, `git status --short`, `git diff --check`, `git ls-files -- .env '.env.*'`; inspección de archivos nuevos y `.tmp/audit-secrets.cjs` | Sin errores de whitespace ni secretos nuevos detectados. `.env` ignorado y no versionado; `.env.template` contiene placeholders. Sin cambios de esquema/migraciones ni lockfile. Índice sin cambios staged. El cotejo contra secretos locales excluye coincidencias ya presentes en HEAD; no sustituye una auditoría de todo el historial. |
| Configuración Joi | `npm test -- --runInBand` | 11/11, incluidos los 8 casos originales y tres URLs inseguras verificadas en desarrollo y producción. |
| Configuración/conexión de correo | Mismo comando, `src/mail/mail.configuration.spec.ts` | 4/4: verificación sin envío, error de autenticación, remitente/enlace y URL inválida. |
| Reintentos y cierre SMTP | Mismo comando, `src/mail/mail.service.spec.ts` | 4/4 restauradas: entrega/cierre, errores transitorios con mismo mensaje, rechazo permanente y agotamiento de tres intentos sin exponer detalles. |
| Cierre antes de inicializar Socket.IO | Mismo comando, `src/realtime/realtime.lifecycle.spec.ts` | 1/1. |
| Preservación del error de arranque | Mismo comando, `src/main.spec.ts` | 1/1 nueva: `listen` y `close` rechazan; el último error registrado sigue siendo el original y el exit code es 1. |
| Suite unitaria completa final | `npm test -- --runInBand` | **48/48; 13/13 suites**, salida 0, 20.66 s. |
| Build final | `npm run build` | Salida 0; genera Prisma Client **7.10.1** y compila Nest. No aplica migraciones. |
| ESLint final sin autofix | `npx eslint "{src,apps,libs,test}/**/*.ts"` | Salida 0, sin diagnósticos. Excluye únicamente el cliente generado `src/generated/prisma/**`, además de la exclusión preexistente. |
| Compose aislado | `docker compose -f docker-compose.test.yml up -d --wait` | PostgreSQL y Mailpit saludables; puertos 55432, 11025 y 18025. |
| Recuperación HTTP real | PowerShell: `$env:TEST_DATABASE_URL='postgresql://audit:local-test-only@127.0.0.1:55432/blog_test'; npm run test:e2e -- --runInBand test/auth-recovery.e2e-spec.ts` | **9/9**, salida 0, 58.186 s. La suite crea y elimina su base aleatoria y aplica allí las migraciones. |
| Correo Mailpit, enlace y cambio de contraseña sintética | Incluido en la suite anterior | Solicitud 202, recepción en Mailpit, enlace `/recuperar/<token>` correcto; contraseña anterior rechazada y nueva aceptada. |
| Tokens/concurrencia/límites | Incluido en la suite anterior | Consumo simultáneo: 204/410; emisión simultánea: un solo token pendiente; token usado y vencido: 410. Límites de recuperación 202/202/202/429 y Retry-After; cabeceras falsas, límites de login, búsqueda y globales cubiertos. |
| Arranque de desarrollo y HTTP 200 | `node .tmp/startup-smoke.cjs`, que ejecuta `npm run start:dev`; `GET http://localhost:4000/api/v1` | Aprobado: `Found 0 errors` y 200. Fixture con base `startup_<aleatorio>_test`, variables sintéticas y preload que impide leer `.env`. Detiene solo sus procesos y elimina su base. Log local: `.tmp/startup-smoke.log`. |
| Prisma/PostgreSQL y `categoria` | Suite HTTP mediante Prisma; fixture de arranque consulta `to_regclass('public.categoria')` | Aprobado en bases aisladas: operaciones Prisma reales sobre categorías y tabla existente. No se repitió contra desarrollo. |
| Gmail sin envío | `npm run mail:check` | Salida 0, repetido tras los cambios finales: conexión y autenticación verificadas. |
| Entrega real Gmail | `node .tmp/send-controlled-mail.cjs`, tras autorización explícita de destinatario/envío | Un único mensaje diagnóstico, aceptado por SMTP, cero rechazos. El usuario confirmó **recibido en bandeja** con código `MAIL-20261113-REVIEW`. Sin enlace activo ni acceso a la base; no acredita recuperación de una cuenta real. |
| Compilación del frontend disponible | En el proyecto hermano: `npm run build` | Salida 0, Next 16.2.6. |
| Recorrido web completo | Next en 3017; navegador real en `/recuperar`, correo sintético y botón «Validar solicitud» | **Bloqueado**: muestra «Esta es una vista previa del frontend. No se ha enviado un correo». `src/features/auth/auth-form.tsx` solo valida localmente; también implementa así reset/login. No se aprobaron correo → `/recuperar/[token]` → cambio → ingreso desde UI. Captura local: `.tmp/frontend-recovery-blocker.png`. |

## Correcciones y límites

- Se restauró `mail.service.spec.ts` en vez de perder sus cuatro escenarios.
- Se corrigieron los tres accesos/asignaciones inseguros de Realtime y dos
  anotaciones faltantes del observador de eventos en `group-access.e2e-spec.ts`.
  Ese cambio de prueba no altera su comportamiento; no se ejecutó la suite de grupos.
- ESLint inicialmente reportó 23 errores: 18 en código generado, tres en Realtime
  y dos en la prueba de grupos. La ejecución final terminó sin errores.
- Joi ahora rechaza credenciales, query y fragmento en `RECOVERY_URL` al arrancar,
  alineado con las restricciones ya existentes del servicio de correo.
- Se añadió una prueba del error original de bootstrap cuando la limpieza falla.
- Los primeros intentos de Docker, SMTP y HTTP fueron bloqueados por permisos del
  sandbox; las repeticiones autorizadas sí se ejecutaron y pasaron. El fixture de
  arranque necesitó corregir la ruta de PowerShell y el escape de `NODE_OPTIONS`.
  Se eliminó expresamente la base sintética residual de ese primer intento.
- La suite HTTP emitió una advertencia de `pg` sobre consultas simultáneas en un
  mismo cliente (deprecación para pg 9); no hubo fallos con la versión instalada.
- Las herramientas locales en `.tmp` son evidencia de esta revisión y están
  ignoradas por Git; no contienen credenciales copiadas desde `.env`.
- Al terminar se detuvieron el servidor Next de prueba y los contenedores
  exclusivos mediante `docker compose -f docker-compose.test.yml down`.

Para cerrar el bloqueo: integrar los formularios del frontend con los endpoints
de recuperación y autenticación, o proporcionar el checkout integrado correcto,
y repetir el recorrido completo con una cuenta sintética y Mailpit. La revisión
del backend no acredita ese flujo web pendiente.
