# Recuperación por correo y pruebas aisladas

## Configuración SMTP

El backend usa Nodemailer SMTP. No configura automáticamente un proveedor real
ni envía correo a cuentas reales durante las pruebas.

| Variable                  | Uso                                                              |
| ------------------------- | ---------------------------------------------------------------- |
| SMTP_HOST                 | Host SMTP.                                                       |
| SMTP_PORT                 | Puerto; 587 por defecto.                                         |
| SMTP_SECURE               | true para TLS desde el inicio, normalmente puerto 465.           |
| SMTP_FROM                 | Dirección remitente autorizada por el proveedor.                 |
| SMTP_USER / SMTP_PASSWORD | Credenciales opcionales; deben configurarse juntas.              |
| RECOVERY_URL              | URL fija del frontend, terminada en /recuperar; se añade /TOKEN. |

En producción se exige configuración SMTP completa y RECOVERY_URL con HTTPS.
Se exige TLS también cuando el transporte usa STARTTLS. No se desactiva la
verificación de certificados. En desarrollo puede arrancar sin SMTP; en ese
caso el endpoint conserva respuesta neutra pero no entrega correo y registra
un aviso sin datos del usuario. Esto no equivale a recuperación operativa.

Ejemplo exclusivo para los servicios locales de pruebas:

```dotenv
SMTP_HOST=127.0.0.1
SMTP_PORT=11025
SMTP_SECURE=false
SMTP_FROM=test@example.test
RECOVERY_URL=http://localhost:3000/recuperar
```

Los tokens se almacenan como hash, vencen a los 30 minutos y se consumen una sola
vez. Emisión y consumo se serializan por usuario. Una solicitud posterior deja
sin validez el enlace anterior, aunque los correos lleguen en distinto orden.
El fallo de envío invalida únicamente el token de esa solicitud.

Se realizan hasta tres intentos ante errores transitorios, con el mismo Message-ID
y token. Una aceptación SMTP seguida de pérdida de conexión puede producir
correo duplicado; no se promete entrega exactamente una vez. Un rechazo
permanente no se reintenta. El remitente/proveedor real requiere validación en staging.

La respuesta de recuperación tiene un mínimo de 12 segundos, tanto para cuentas
existentes como inexistentes o errores de entrega. Los timeouts SMTP son de un
segundo por fase y los reintentos tienen espera de 250/500 ms. Debe medirse la
latencia del proveedor antes del despliegue; ajustar transporte y ventana juntos
si esos límites fueran insuficientes. No es una garantía de tiempo constante
frente a bloqueos prolongados de BD o agotamiento de recursos.

## Límites de autenticación

Registro/login/reset: 5 por minuto y dirección IP; recuperación: 3 por hora e IP.
Responde 429 con Retry-After. No confía en X-Forwarded-For enviado arbitrariamente.
El almacenamiento actual es por proceso y se reinicia al reiniciar Nest.

S01 añade límite global 100/min, búsqueda 30/min, firma BFF y auditoría HTTP.
La activación del proxy real y el almacenamiento compartido siguen pendientes;
sin firma configurada, clientes detrás de Next pueden compartir contador. Los
contadores actuales solo garantizan una instancia. Consultar
[SEGURIDAD_Y_PROXY.md](SEGURIDAD_Y_PROXY.md) antes de desplegar estos cambios.
Las pruebas HTTP usan el guard real; cada caso comienza una ventana independiente.

## Ejecutar la integración

Desde blog-backend:

```bash
docker compose -f docker-compose.test.yml up -d --wait
npm ci
npm run build
npm test -- --runInBand
TEST_DATABASE_URL=postgresql://audit:local-test-only@127.0.0.1:55432/blog_test npm run test:e2e
```

Las credenciales anteriores son públicas y exclusivas de la BD sintética.
PostgreSQL usa tmpfs, puertos ligados a loopback y proyecto Compose separado.
El buzón está en http://127.0.0.1:18025; todos sus mensajes son de prueba.
Las suites no usan la DATABASE_URL de desarrollo, crean sus propios esquemas/BD
y los eliminan al finalizar. El contenedor no monta directorios del proyecto.

```bash
docker compose -f docker-compose.test.yml down
```

Ese comando detiene únicamente el entorno de pruebas y elimina sus datos
temporales. No usar el compose de desarrollo para estas pruebas.

## Migraciones y despliegue

20261108000100_generated_search conserva publicaciones y reemplaza solo el
vector derivado; lo recalcula para filas existentes y agrega el índice GIN.
20261108000200_business_checks incorpora las 13 restricciones del apéndice A.
Ambas son transaccionales. Si existen filas incompatibles, la segunda falla
completa: no elimina ni repara datos automáticamente.

Antes de aplicar fuera del entorno de pruebas: identificar filas incompatibles,
acordar reparación, respaldar y ensayar restauración, y medir bloqueos de tabla
en datos representativos. Una prueba pequeña no demuestra ausencia de bloqueo
en producción. No se han aplicado a las bases de desarrollo ni producción.
