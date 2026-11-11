# Pruebas aisladas de integración

Las pruebas no reutilizan la base de desarrollo. Requieren dependencias instaladas,
cliente `psql` y los servicios exclusivos de `docker-compose.test.yml`.

Desde `blog-backend`:

```bash
docker compose -f docker-compose.test.yml up -d --wait
npm ci
npm run build
npm test -- --runInBand
TEST_DATABASE_URL=postgresql://audit:local-test-only@127.0.0.1:55432/blog_test npm run test:e2e
```

La URL contiene credenciales públicas exclusivas del entorno sintético. La suite
HTTP exige exactamente ese destino local; la suite SQL exige host local, nombre
terminado en `_test` y ausencia de parámetros adicionales. Nunca señalar bases con
datos reales, aunque su nombre termine en `_test`.

## Alcance

- `search-migration.e2e-spec.ts`: esquema aleatorio; migración inicial, datos
  anteriores a la corrección, vector generado, índice GIN, inserción/edición y las
  13 restricciones CHECK del DOCX. Elimina únicamente su esquema al finalizar.
- `auth-recovery.e2e-spec.ts`: base aleatoria independiente, migraciones y Nest real.
  Registro, rol administrador, login/me, correo recibido en Mailpit, token usado/
  vencido, emisión y consumo concurrentes, límites HTTP, búsqueda filtrada y CRUD.
  Cada caso restablece los contadores del guard, sin sustituirlo por un mock.
- Pruebas unitarias: validación de configuración, fallos de recuperación y SMTP
  con reintentos acotados. No llaman a proveedores reales.
- `post-operations.e2e-spec.ts`: ocho casos con BD independiente y todas las migraciones.
  POST concurrente, clave/payload distintos, PATCH antiguo tras otra edición,
  DELETE repetido, recibo tras borrado, aislamiento/expiración y rollback de la
  publicación si falla el recibo. Usa JWT sintético firmado por el módulo real;
  no sustituye el guard ni los repositorios. No necesita enviar correo.
- `group-access.e2e-spec.ts`: base aleatoria independiente y todas las migraciones;
  Nest, JWT, guards, repositorios y PostgreSQL reales. Matriz de roles, correo ausente
  de respuestas/búsqueda, salida/expulsión, propias/contadores y normalización.
  Prueba salidas, degradaciones, expulsiones y transferencias simultáneas; verifica
  esperas reales con `pg_blocking_pids` antes de revocar permisos y liberar el lock.
  Solo sustituye el proveedor de archivos: prueba revocación durante subida,
  compensación y desvinculación confirmada antes de una limpieza externa fallida.
  Ahora verifica también descarga autorizada/revocación durante lectura, validación binaria y cola durable. El proveedor se sustituye; no acredita la configuración Cloudinary externa. Incluye comentarios, reportes, retenidos, notificaciones, suspensión y dos instancias WebSocket. No necesita correo.
- `esm-transformer.cjs`: adaptación de dependencias ESM a Jest 29; la clave de
  caché incluye el propio transformador y la configuración.

## Navegador real con ambos proyectos

Compilar también `blog-frontend` y disponer de Chromium de Playwright:

```bash
# Desde blog-frontend
npm ci
npm run build
./node_modules/.bin/playwright install chromium
# Desde blog-backend
node test/web-smoke.cjs
```

El script crea una BD `web_<aleatorio>_test`, inicia Nest en 24001, Next en 3017 y un proxy local en 3016,
y ejecuta Chromium contra el BFF real. Para medios precarga explícitamente un stub de Cloudinary y sirve un PNG local en 24002; no sube archivos al proveedor real. Usa usuarios sintéticos. Comprueba feed,
búsqueda, paginación, detalle/404, sanitización, móvil, CRUD con cuerpo mayor de
8 KiB, conflicto entre pestañas, Origin, sesión, propias por estado y aislamiento
de cuentas, foto de perfil e imágenes de publicación (subir/ver/eliminar y fallo parcial). Comprueba también rechazo de edición ajena. Cierra esos procesos y
elimina su propia BD al terminar; necesita los cuatro puertos libres (3016, 3017, 24001 y 24002). No arranca ni
reinicia los contenedores de desarrollo. No registra cuerpos de autenticación.

Mailpit local: `http://127.0.0.1:18025`; SMTP: 11025; PostgreSQL: 55432.
Los buzones contienen únicamente datos sintéticos. Para detener el entorno:

```bash
docker compose -f docker-compose.test.yml down
```

La base usa tmpfs: se descarta al detener el entorno. No confundir este compose
con el de desarrollo. Las pruebas pequeñas no demuestran rendimiento en producción,
privacidad de archivos Cloudinary ni cobertura de módulos aún pendientes.
Ver también [recuperación y configuración](../docs/RECUPERACION_Y_PRUEBAS.md).

El proxy de prueba sobrescribe x-real-ip y elimina XFF/x-blog-* del cliente. Next firma la identidad con un secreto efímero compartido con Nest. La suite también comprueba presupuestos por cliente, cabeceras falsificadas, correlación y Retry-After. El cambio de IP es controlado por el fixture, no por el navegador.

`web-smoke.cjs` incorpora `publication-recovery-smoke.cjs`: navegación de Next con
borrador (enlace, Atrás, Adelante y recarga cancelados), doble clic, 503 antes del
commit, respuesta POST/PATCH/DELETE perdida después del commit, reintento con
clave/cuerpo idénticos, comprobación de recibos, 401, reautenticación en otra pestaña
y cambio de cuenta sin recuperar el borrador anterior. Verifica filas en su BD.
Las respuestas perdidas se provocan con `route.fetch()` seguido de `route.abort()`;
los datos se guardan realmente antes de simular la pérdida de respuesta.

**Estado al 9/11/2026, entrega P03:** **33/33 SQL/HTTP aprobadas y smoke Chromium
ampliado aprobado**, ejecutados contra el compose aislado mediante los comandos
autorizados. Incluye aplicación de todas las migraciones en bases temporales. La
suite adicional del frontend con Postman no inició por `connect EPERM` en 4020;
sus 35 casos no se cuentan como aprobados. Informe: [entrega P03](../../docs/ENTREGA_P03_2026-11-09.md).


## Revisión del 10/11/2026

La regresión actual contiene **89 pruebas SQL/HTTP/WebSocket** aprobadas, 33 unitarias backend y 71 frontend. Los números del 9/11 arriba son históricos. `auth-recovery` y `group-access` aplican todas las migraciones numeradas a su base temporal.

`groups-content-smoke.cjs` se ejecuta dentro de `web-smoke.cjs`: dos navegadores, roles/transferencia, publicación privada, imagen/PDF/enlace y orden, comentarios/respuestas en vivo, borrador tras expirar sesión, retirada con observación, reportes/retenidos y avisos. El proxy de prueba encamina upgrades `/tiempo-real` directamente a Nest, con Origin/cookie reales. El stub sirve bytes del archivo subido únicamente al servidor de prueba; no es una configuración de producción.

El script guarda capturas de muro escritorio/móvil y transferencia en `.tmp/screenshots/`; ante un fallo de grupos, conserva una captura sintética de diagnóstico. Los cambios de IP del fixture separan escenarios funcionales del presupuesto global; los casos específicos de límites siguen usando la misma IP y cabeceras falsas para verificar 429.

El smoke Chromium completo pasó y se inspeccionaron las capturas móvil/escritorio/transferencia. Evidencia y límites: [entrega de publicaciones/grupos](../../docs/AVANCE_PUBLICACIONES_GRUPOS_2026-11-10.md). Guía del proxy y trabajadores: [operación](../../docs/OPERACION_PUBLICACIONES_GRUPOS.md).


## Administración global AD01

`node test/web-smoke.cjs --admin-only` inicia el mismo entorno aislado y ejecuta únicamente resumen, búsqueda de usuarios, suspensión/reactivación manual y listado global de publicaciones. El smoke completo incluye también este recorrido después de grupos. La elevación de rol se hace únicamente dentro de la base sintética recién creada por el fixture. No modifica cuentas de desarrollo o producción.

La suite SQL contiene 90 casos, incluido acceso global frente a usuario/administrador local, filtros, rechazo de autosuspensión/duración inválida y recuperación del acceso después de reactivar. Evidencia actual: [entrega AD01](../../docs/ENTREGA_AD01.md).

## Contratos C01

`npm run contracts:check` valida el OpenAPI generado, inventario de 42 operaciones y fixtures. El helper HTTP de `group-access.e2e-spec.ts` valida respuestas contra esos esquemas y captura ejemplos en `.tmp/contracts/http-fixtures.json`. Publicar sólo capturas de la base sintética aprobada; ver [mantenimiento](../docs/contracts/README.md). Última regresión C01: 91/91; una ejecución previa falló en recuperación concurrente y sigue registrada en [la entrega](../../docs/ENTREGA_C01.md).
