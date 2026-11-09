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

El script crea una BD `web_<aleatorio>_test`, inicia Nest en 24001 y Next en 3016,
y ejecuta Chromium contra el BFF real. Para medios precarga explícitamente un stub de Cloudinary y sirve un PNG local en 24002; no sube archivos al proveedor real. Usa usuarios sintéticos. Comprueba feed,
búsqueda, paginación, detalle/404, sanitización, móvil, CRUD con cuerpo mayor de
8 KiB, conflicto entre pestañas, Origin, sesión, propias por estado y aislamiento
de cuentas, foto de perfil e imágenes de publicación (subir/ver/eliminar y fallo parcial). Comprueba también rechazo de edición ajena. Cierra esos procesos y
elimina su propia BD al terminar; necesita los tres puertos libres. No arranca ni
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
