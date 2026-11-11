# S01: límites, identidad del cliente y auditoría HTTP

Actualizado: 9 de noviembre de 2026. Implementación verificada localmente para
**una instancia/proceso de Nest**. La activación en el despliegue real todavía
requiere confirmar su topología y configurar ambos servidores.

## Política implementada

| Operación | Límite por IP verificada | Ventana |
|---|---:|---|
| API global | 100 | 1 minuto |
| Login | 5 | 1 minuto |
| Registro | 5 | 1 minuto |
| Restablecer contraseña | 5 | 1 minuto |
| Solicitar recuperación | 3 | 1 hora |
| Búsqueda pública | 30 | 1 minuto |

El presupuesto global se aplica primero e incluye los intentos rechazados por
límites específicos. /posts/search y /posts?q=… comparten el presupuesto de búsqueda.
La comprobación de salud del AppController queda exenta. Los límites son ventanas
fijas iniciadas por la primera petición, con máximo de 10000 contadores en memoria.
Los contadores se pierden al reiniciar Nest; no hay almacenamiento compartido.
Reportes ya incorpora 10 intentos/hora por IP en el guard y 10 creaciones/hora por cuenta en PostgreSQL, con lock transaccional compartido entre instancias. Los demás límites siguen en memoria.

## Identidad entre Next y Nest

Nest ignora X-Forwarded-For arbitrario. Solo acepta la identidad remitida por Next
cuando una firma HMAC-SHA256 válida cubre IP normalizada, fecha, método y ruta
completa con consulta. La ventana admitida es de 30 segundos; ambos relojes deben
estar sincronizados. La comparación de firmas usa timingSafeEqual. No es una
credencial de usuario: cookie JWT y permisos siguen siendo obligatorios.

Cabeceras internas: x-blog-client-ip, x-blog-client-time y
x-blog-client-signature. Next las genera y nunca copia las enviadas por el
navegador. Una firma ausente/inválida no concede identidad: Nest usa la dirección
del socket, sin confiar en trust proxy. Esto conserva compatibilidad con llamadas
directas, pero detrás de un proxy puede agrupar clientes; configurar y probar la
firma es necesario para resolver ese problema en el BFF desplegado.

### Variables

En **ambos servidores**, configurar BFF_IDENTITY_SECRET con el mismo secreto
aleatorio de al menos 32 caracteres. Usar 32 bytes aleatorios, por ejemplo
`openssl rand -hex 32`, ejecutado localmente. No reutilizar JWT_SECRET ni usar
NEXT_PUBLIC_ ni pegar valores en chat, logs o documentación. Backend valida la
longitud si la variable está presente. Omitir la variable si no se utiliza;
no añadir una variable opcional vacía.

En **Next**, configurar BFF_CLIENT_IP_SOURCE:

| Valor | Uso |
|---|---|
| none (predeterminado) | No firma. Adecuado para pruebas locales de un cliente; no resuelve agrupación tras el BFF. |
| vercel | Requiere VERCEL=1 e IP válida en x-vercel-forwarded-for. No usa un XFF arbitrario. |
| trusted-proxy | Lee x-real-ip. Solo habilitar con Next inaccesible directamente y un proxy que sobrescriba esa cabecera. |

La [documentación oficial de Vercel](https://vercel.com/docs/headers/request-headers)
describe sus cabeceras de IP. Un proxy adicional delante de Vercel puede cambiar
la IP observable; verificar esa topología antes de activarlo. No simular VERCEL=1
en un servidor expuesto directamente.

Para trusted-proxy no basta con nombrar una cabecera: el proxy debe reemplazarla
con la IP que él verifica y el origen Next debe quedar restringido por red.
No activar este modo en un Next público que acepte x-real-ip del navegador.
La prueba local monta expresamente un proxy que elimina cabeceras falsificadas;
no demuestra que un proxy de producción esté configurado así.

Si se selecciona un modo y falta la IP válida, el entorno Vercel o el secreto,
Next responde 503 ProxyConfigurationError en lugar de inventar una identidad.
Las categorías con caché pública no llevan identidad de cliente. No se cambia
su caché compartida por una firma por usuario.

### Activación y límites operativos

1. Confirmar frontend, backend, proxies y número de procesos/réplicas de Nest.
2. Configurar el secreto en ambos entornos y la fuente correspondiente en Next;
   actualizar ambos despliegues sin publicar credenciales.
3. Verificar con dos clientes de prueba que agotar un límite no bloquea al otro;
   comprobar que cambiar XFF/x-blog-* desde el navegador no lo elude.
4. Mantener una sola instancia de Nest hasta incorporar almacenamiento compartido.
   No atribuir al mapa actual garantías entre réplicas o reinicios.

No se ha aplicado esta configuración al despliegue del usuario. Su topología
seguía sin confirmar al redactar esta entrega. No se modificaron .env reales ni se reiniciaron servicios de desarrollo; tampoco
se aplicaron migraciones a sus datos.

## Errores y registro

Nest emite statusCode/message compatibles, código estable, fecha, ruta parametrizada
y UUID de correlación. El mismo UUID se envía en X-Request-ID. El BFF conserva
identificadores válidos y, en 429, Retry-After (1–3600 segundos) y retryAfter en JSON.
No reenvía cuerpos HTML, detalles de proveedores ni errores SQL. P2002 se traduce
a conflicto de unicidad y P2025 a recurso inexistente; otros errores Prisma no se
convierten indiscriminadamente en 409.

Solo 401 y AccountSuspended invalidan la sesión. Forbidden/Origin mantienen cookie
identidad y caché de perfil. Auth, perfil y contenido comparten ahora el traductor
de errores; sus transportes de éxito aún no están totalmente unificados (C02).

La auditoría registra mutaciones y errores al terminar la respuesta, incluidos
rechazos de guards: método, plantilla de ruta, estado, correlación e ID del actor
cuando el guard lo haya autenticado. No registra cuerpo, consulta, IP, cookies,
contraseñas, firma del BFF ni tokens; rutas desconocidas se etiquetan <unmatched>.
Es auditoría HTTP en logs del proceso, no un historial persistente de moderación
ni una garantía de retención/entrega de logs. Fallos internos de SMTP y proveedor
requieren instrumentación adicional para correlación de dominio.

Login inexistente ejecuta bcrypt con un hash sintético de costo 12 antes de
responder Invalid credentials, al igual que una contraseña errónea. No se promete
tiempo idéntico entre cuentas, consultas de BD o hashes históricos de otro costo.
Producción exige JWT_SECRET de al menos 32 caracteres: la longitud no demuestra
entropía; usar un valor aleatorio. No se rotó el secreto del despliegue.

## Evidencia y pendientes

- 16 pruebas unitarias backend; 49 frontend; 25 SQL/HTTP con PostgreSQL/Mailpit.
- Nest real verifica límites global, auth, recuperación y búsqueda, independencia
  de identidades firmadas y cabeceras falsas sin autoridad.
- Unitarias: firma vencida/alterada, cambio de método/ruta/secreto, normalización,
  auditoría sin datos sensibles y comparación bcrypt para cuentas inexistentes.
- Chromium: proxy local → Next → firma → Nest. Mantiene regresiones de contenido,
  sesión y medios; demuestra 30 búsquedas admitidas, 31.ª rechazada, otro cliente
  admitido, correlación y Retry-After conservados hasta el navegador. El proveedor
  de imágenes sigue simulado en estas pruebas.
- Builds, lint del frontend y archivos backend modificados aprobados.

S01 sigue parcial en operación: activación/verificación del proxy real, store
compartido si hay réplicas, límite de reportes futuro, revisión CORS/HTTPS/TLS del
despliegue, configuración y medición del pool y retención de logs. Prisma conserva
su configuración anterior de TLS para DYNO (rejectUnauthorized:false); no se
presenta esta entrega como cierre de esa revisión ni de toda la seguridad.
