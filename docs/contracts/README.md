# Contratos C01: contenido y comunidad

El contrato importable es [content.openapi.json](content.openapi.json), OpenAPI 3.0.3. Su fuente mantenible es [content.openapi.cjs](content.openapi.cjs). Describe 42 operaciones Nest bajo `/api/v1`: categorías, publicaciones, recursos, grupos, conversación, moderación, notificaciones y administración, además de publicaciones propias y muro personal.

No instala Swagger UI, no expone un endpoint de documentación y no verifica un despliegue remoto. Auth/perfil conserva su especificación existente en `blog-frontend/postman/contracts/auth.openapi.yaml`; el índice de integración es [contratos-api.md](../../../docs/contratos-api.md) desde este directorio. WebSocket `/tiempo-real` permanece documentado en ese índice y en la guía operativa: no es una ruta REST.

## Actualizar y comprobar

Desde `blog-backend`:

```sh
npm run contracts:generate
npm run contracts:check
```

El segundo comando compara fuente/JSON, extrae las operaciones de los controladores usando el AST de TypeScript, comprueba referencias, parámetros de ruta, operationId únicos, respuestas 204, compila los esquemas con Ajv y valida los ejemplos capturados. También prueba rechazos de IDs numéricos de salida, roles desconocidos, dos objetivos de reporte y campos internos inesperados. No sustituye un validador completo del documento OpenAPI ni la autorización en ejecución.

`test/group-access.e2e-spec.ts` valida las respuestas HTTP contra los mismos esquemas mientras ejecuta permisos y concurrencia con PostgreSQL aislado. Escribe ejemplos sintéticos en `.tmp/contracts/http-fixtures.json`. Después de una ejecución aprobada, copiar ese archivo a `docs/contracts/http-fixtures.json` y a `blog-frontend/postman/contracts/community-http-fixtures.json`. Las pruebas frontend `tests/contracts.test.ts` aplican los adaptadores reales a estos ejemplos. No capturar tráfico de usuarios ni cookies: los ejemplos proceden exclusivamente del seed de la base efímera.

Los fixtures representan respuestas observadas, no todos los estados posibles. Los casos binarios se prueban en integración sin serializar archivos en JSON; las respuestas 204 se validan sin cuerpo. Las pruebas existentes de los adaptadores complementan null, roles, límites de bigint y errores. Las respuestas se registran antes de adaptarlas a los nombres web.

## Convenciones que no deben unificarse accidentalmente

- IDs de salida de contenido/grupos: strings bigint. IDs de entrada de publicaciones y orden de adjuntos: números; el navegador exige conversión segura. Grupos/transferencia aceptan string o número seguro.
- `Post.status`: `retained`; `OwnPost.status`: `held`; moderación y administración: `retenido`. Son variantes reales del runtime.
- Categoría en Post: `id`; catálogo, grupos y propias: `categoryId`.
- `updatedAt`, descripción, foto, grupo y contexto de comentario pueden ser null. No inventar fechas o autores.
- POST/PATCH de publicación con Idempotency-Key devuelve recibo. Sin clave devuelve publicación. DELETE sigue siendo 204; la confirmación se consulta por GET con X-Post-Owner.
- Adjuntos no exponen cloudinaryPublicId, delivery ni mime en JSON; el repositorio sí los utiliza internamente. Perfil todavía requiere revisar photoPublicId en A02.
- Administración sólo global. Miembros/transferencia sólo administración local vigente: el rol global no concede membresía o autoría.
- Esquemas de entrada fijan el formato recomendado; las restricciones condicionales y de negocio están descritas en cada operación (p. ej. versión para revisar posts, observación al retirar contenido ajeno). `@IsOptional` del runtime también omite validación para null.

Referencia del formato: [OpenAPI 3.0.3](https://spec.openapis.org/oas/v3.0.3.html).
