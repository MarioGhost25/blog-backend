// Canonical source. Run npm run contracts:generate after editing.
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const str = { type: 'string' };
const text = (min, max) => ({ ...str, minLength: min, maxLength: max });
const integer = { type: 'integer', minimum: 0 };
const positive = { type: 'integer', minimum: 1 };
const bool = { type: 'boolean' };
const date = { ...str, format: 'date-time' };
const nullable = (schema) => ({ ...schema, nullable: true });
const enumeration = (...values) => ({ ...str, enum: values });
const array = (items) => ({ type: 'array', items });
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const id = {
  ...str,
  pattern: '^[1-9][0-9]{0,18}$',
  description:
    'Decimal bigint positivo, máximo 9223372036854775807 (validado en servidor). Nunca convertir salidas a Number.',
};
const inputId = {
  oneOf: [id, { ...positive, maximum: Number.MAX_SAFE_INTEGER }],
};
const page = (name) =>
  object({ items: array(ref(name)), nextCursor: nullable(str) });
const role = enumeration('member', 'moderator', 'administrator');
const state = enumeration('visible', 'retenido', 'eliminado');
const reportState = enumeration(
  'pendiente',
  'desestimado',
  'contenido_retirado',
  'usuario_suspendido',
);
const category = { categoryId: id, name: str, description: nullable(str) };
const post = {
  id,
  authorId: id,
  categoryId: id,
  groupId: nullable(id),
  title: str,
  content: str,
  status: enumeration('visible', 'retained', 'deleted'),
  version: positive,
  createdAt: date,
  updatedAt: nullable(date),
  author: object({
    id,
    firstName: str,
    lastName: str,
    photoUrl: nullable(str),
  }),
  category: object({ id, name: str, description: nullable(str) }),
  group: nullable(object({ id, name: str })),
  attachments: array(ref('Attachment')),
  commentCount: integer,
};
const group = {
  groupId: id,
  categoryId: id,
  creatorId: id,
  name: str,
  description: nullable(str),
  createdAt: date,
  category: object(category),
  _count: object({ members: integer }),
  myRole: { ...str, nullable: true, enum: [...role.enum, null] },
};
const schemas = {
  Category: object(category),
  Attachment: object({
    id,
    postId: id,
    type: enumeration('image', 'document', 'link'),
    title: str,
    url: str,
    order: positive,
  }),
  Post: object(post),
  PostDetail: object({
    ...post,
    permissions: object({ edit: bool, moderate: bool }),
  }),
  PostPage: page('Post'),
  OwnPost: object({
    postId: id,
    authorId: id,
    categoryId: id,
    groupId: nullable(id),
    title: str,
    content: str,
    status: enumeration('visible', 'held', 'deleted'),
    version: positive,
    createdAt: date,
    updatedAt: nullable(date),
    category: object(category),
    _count: object({ comments: integer, attachments: integer }),
  }),
  OwnPostPage: page('OwnPost'),
  Receipt: object({
    status: enumeration('confirmed'),
    key: { ...str, format: 'uuid' },
    method: enumeration('POST', 'PATCH', 'DELETE'),
    postId: id,
    version: positive,
  }),
  UnknownOperation: object({ status: enumeration('unknown') }),
  CreatePost: object(
    {
      title: text(3, 150),
      content: text(1, 20000),
      categoryId: positive,
      groupId: positive,
    },
    ['title', 'content', 'categoryId'],
  ),
  UpdatePost: object(
    {
      title: text(3, 150),
      content: text(1, 20000),
      categoryId: positive,
      version: positive,
    },
    ['version'],
  ),
  RemoveContent: object({ observation: text(5, 1000) }, []),
  LinkInput: object({
    type: enumeration('link'),
    title: text(1, 150),
    url: { ...text(1, 1024), format: 'uri', pattern: '^https?://' },
  }),
  FileInput: object({
    type: enumeration('image', 'document'),
    title: text(1, 150),
    file: { ...str, format: 'binary' },
  }),
  AttachmentOrder: object({
    attachmentIds: { ...array(positive), minItems: 1, uniqueItems: true },
  }),
  Group: object(group),
  GroupDetail: object({
    ...group,
    administrators: array(
      object({ userId: id, name: str, lastName: str, photoUrl: nullable(str) }),
    ),
  }),
  GroupPage: page('Group'),
  Membership: object({ groupId: id, userId: id, role, joinedAt: date }),
  Member: object({
    role,
    joinedAt: date,
    user: object({
      userId: id,
      name: str,
      lastName: str,
      major: nullable(str),
      photoUrl: nullable(str),
    }),
  }),
  MemberPage: page('Member'),
  CreateGroup: object(
    { name: text(3, 100), categoryId: inputId, description: text(0, 1000) },
    ['name', 'categoryId'],
  ),
  ChangeRole: object({ role }),
  Transfer: object({ newAdministratorId: inputId, leave: bool }),
  Comment: object({
    id,
    postId: id,
    author: object({ id, name: str, lastName: str }),
    content: nullable(str),
    status: state,
    createdAt: date,
    parent: nullable(object({ id, content: nullable(str) })),
  }),
  CommentPage: page('Comment'),
  CreateComment: object({ content: text(1, 2000), parentCommentId: id }, [
    'content',
  ]),
  CreateReport: {
    oneOf: [
      object({ postId: id, reason: text(5, 500) }),
      object({ commentId: id, reason: text(5, 500) }),
    ],
  },
  ReportCreated: object({ id, status: reportState }),
  Report: object({
    id,
    reason: str,
    status: reportState,
    observation: nullable(str),
    createdAt: date,
    postId: id,
    groupId: nullable(id),
    title: str,
    content: str,
    type: enumeration('post', 'comment'),
    targetId: id,
    contentStatus: state,
  }),
  ReportPage: page('Report'),
  ResolveReport: object(
    {
      decision: enumeration(
        'desestimado',
        'contenido_retirado',
        'usuario_suspendido',
      ),
      observation: text(5, 1000),
      suspensionDays: { ...positive, maximum: 90 },
    },
    ['decision', 'observation'],
  ),
  Retained: object({
    id,
    type: enumeration('post', 'comment'),
    postId: id,
    title: str,
    content: str,
    version: nullable(positive),
  }),
  RetainedPage: page('Retained'),
  Review: object(
    {
      decision: enumeration('publish', 'remove'),
      observation: text(0, 1000),
      version: positive,
    },
    ['decision'],
  ),
  Notification: object({
    id,
    type: enumeration(
      'comentario',
      'respuesta',
      'publicacion_grupo',
      'resultado_reporte',
      'contenido_retirado',
      'nuevo_reporte',
    ),
    message: str,
    href: nullable({
      ...str,
      pattern:
        '^/(publicaciones/[1-9][0-9]*|moderacion|grupos/[1-9][0-9]*/moderacion)$',
    }),
    createdAt: date,
    readAt: nullable(date),
  }),
  NotificationPage: object({
    items: array(ref('Notification')),
    nextCursor: nullable(str),
    unreadCount: integer,
  }),
  Count: object({ count: integer }),
  ReadThrough: object({ throughId: id }),
  Summary: object({
    days: { type: 'integer', enum: [7, 30] },
    users: integer,
    suspended: integer,
    posts: integer,
    comments: integer,
    reports: integer,
    groups: integer,
  }),
  AdminUser: object({
    id_usuario: id,
    nombre: str,
    apellido: str,
    rol: enumeration('usuario', 'administrador'),
    estado: enumeration('activo', 'suspendido'),
    suspendido_hasta: nullable(date),
  }),
  AdminUserPage: page('AdminUser'),
  AdminPost: object({
    id_publicacion: id,
    titulo: str,
    estado: state,
    version: positive,
    id_grupo: nullable(id),
    id_autor: id,
  }),
  AdminPostPage: page('AdminPost'),
  Suspension: object({
    days: { ...positive, maximum: 90 },
    reason: text(5, 500),
  }),
  Error: object({
    statusCode: { type: 'integer', minimum: 400, maximum: 599 },
    error: str,
    message: { oneOf: [str, array(str)] },
    idCorrelacion: { ...str, format: 'uuid' },
    ruta: str,
    fecha: date,
  }),
};
const query = (name, schema = str) => ({
  in: 'query',
  name,
  required: false,
  schema,
});
const pagination = [
  query('cursor'),
  query('limit', { ...positive, maximum: 50 }),
];
const postFilters = [
  ...pagination,
  query('q', text(2, 254)),
  query('categoryId', positive),
];
const memberFilters = [...pagination, query('q', text(0, 254))];
const moderationFilters = [
  query('cursor'),
  query('groupId', id),
  query('status', reportState),
  query('type', enumeration('post', 'comment')),
];
const owner = {
  in: 'header',
  name: 'X-Post-Owner',
  required: false,
  schema: id,
  description:
    'Cuenta que abrió el formulario. Obligatorio con Idempotency-Key y para consultar recibos; si se envía en mutaciones protegidas debe coincidir con la sesión.',
};
const key = {
  in: 'header',
  name: 'Idempotency-Key',
  required: false,
  schema: {
    ...str,
    pattern:
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  },
  description:
    'UUID v4 canónico. Reutilizar sólo con la misma cuenta, método, destino y contenido; discrepancia produce 409.',
};
const paths = {};
function route(method, path, summary, output, options = {}) {
  const {
    status = method === 'post' ? 201 : 200,
    input,
    params = [],
    access = 'authenticated',
    description = '',
    media,
  } = options;
  const parameters = [...path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({
    in: 'path',
    name,
    required: true,
    schema:
      name === 'type'
        ? enumeration('post', 'comment')
        : name === 'key'
          ? key.schema
          : id,
  }));
  const success = {
    description:
      status === 204
        ? 'Operación completada, sin cuerpo.'
        : 'Respuesta correcta.',
  };
  if (output)
    success.content = {
      'application/json': {
        schema: typeof output === 'string' ? ref(output) : output,
      },
    };
  if (media)
    success.content = Object.fromEntries(
      media.map((mime) => [
        mime,
        { schema: { type: 'string', format: 'binary' } },
      ]),
    );
  const operation = {
    operationId: `${method}_${path.replace(/[^a-zA-Z0-9]+/g, '_')}`,
    summary,
    description,
    tags: [path.split('/')[1]],
    security:
      access === 'public'
        ? []
        : access === 'optional'
          ? [{}, { cookieAuth: [] }]
          : [{ cookieAuth: [] }],
    parameters: [...parameters, ...params],
    responses: {
      [status]: success,
      default: {
        description:
          'Error HTTP. 400 validación; 401 sesión; 403 permisos/cuenta; 404 inexistente o no visible; 409 versión/invariantes; 410 recurso legado; 413 tamaño; 429 límite; 5xx infraestructura. Aplican según operación; no todos se generan en cada ruta.',
        content: { 'application/json': { schema: ref('Error') } },
      },
    },
  };
  if (input)
    operation.requestBody = {
      required: input !== 'RemoveContent',
      content: { 'application/json': { schema: ref(input) } },
    };
  if (options.body) operation.requestBody = options.body;
  (paths[path] ??= {})[method] = operation;
}
route('get', '/categories', 'Catálogo público', array(ref('Category')), {
  access: 'public',
});
route('get', '/posts', 'Muro público', 'PostPage', {
  access: 'public',
  params: postFilters,
});
route('get', '/posts/search', 'Búsqueda pública', 'PostPage', {
  access: 'public',
  params: postFilters,
});
route('get', '/posts/group/{groupId}', 'Muro del grupo', 'PostPage', {
  params: postFilters,
  description: 'Membresía vigente o administrador global para lectura.',
});
route('get', '/users/me/feed', 'Muro personal', 'PostPage', {
  params: postFilters,
});
route('get', '/users/me/posts', 'Publicaciones propias', 'OwnPostPage', {
  params: [
    query('cursor'),
    query('status', enumeration('visible', 'held', 'deleted')),
  ],
  description:
    'Página fija de 20. No admite limit. Excluye contenido grupal cuando se perdió acceso.',
});
route('get', '/posts/{id}', 'Detalle y permisos', 'PostDetail', {
  access: 'optional',
});
route(
  'get',
  '/posts/operations/{key}',
  'Consultar recibo',
  { oneOf: [ref('Receipt'), ref('UnknownOperation')] },
  { params: [{ ...owner, required: true }] },
);
route(
  'post',
  '/posts',
  'Crear publicación',
  { oneOf: [ref('Post'), ref('Receipt')] },
  {
    input: 'CreatePost',
    params: [owner, key],
    description:
      'Con clave devuelve Receipt; sin clave devuelve Post. Grupo: exige membresía. Texto prohibido queda retenido; contenido HTML se sanitiza.',
  },
);
route(
  'patch',
  '/posts/{id}',
  'Editar publicación',
  { oneOf: [ref('Post'), ref('Receipt')] },
  {
    input: 'UpdatePost',
    params: [owner, key],
    description:
      'Sólo autor con acceso actual. version requerida; conflicto 409. Con clave devuelve Receipt.',
  },
);
route('delete', '/posts/{id}', 'Retirar publicación', null, {
  status: 204,
  input: 'RemoveContent',
  params: [owner, key],
  description:
    'Autor o moderador autorizado. Observation obligatoria si no es autor. Rama idempotente exclusiva del autor; recuperar recibo por GET.',
});
route('post', '/posts/{id}/attachments', 'Añadir recurso', 'Attachment', {
  body: {
    required: true,
    content: {
      'application/json': { schema: ref('LinkInput') },
      'multipart/form-data': { schema: ref('FileInput') },
    },
  },
  params: [owner],
  description:
    'Sólo autor. JPEG/PNG/PDF validado por bytes, hasta 10 MiB en Nest; BFF limita a 4 MiB. Link requiere URL HTTP(S). Máximo y orden ver política de adjuntos.',
});
route(
  'get',
  '/posts/{id}/attachments/{attachmentId}/content',
  'Descargar recurso protegido',
  null,
  {
    access: 'optional',
    media: ['image/jpeg', 'image/png', 'application/pdf'],
    description:
      'Revalida acceso antes y después de leer. private,no-store; Vary Cookie; nosniff; CSP sandbox. Legados no migrados: 410. Documentos como attachment.',
  },
);
route(
  'patch',
  '/posts/{id}/attachments/order',
  'Ordenar recursos',
  array(ref('Attachment')),
  {
    input: 'AttachmentOrder',
    params: [owner],
    description:
      'Sólo autor. Deben enviarse todos los IDs, exactamente una vez, como números.',
  },
);
route(
  'delete',
  '/posts/{id}/attachments/{attachmentId}',
  'Eliminar recurso',
  null,
  { status: 204, params: [owner] },
);
route('post', '/groups', 'Crear grupo', 'Group', {
  input: 'CreateGroup',
  description: 'Creador pasa a administrador local.',
});
route('get', '/groups', 'Catálogo de grupos', 'GroupPage', {
  params: [...memberFilters, query('categoryId', inputId), query('mine', bool)],
});
route('get', '/groups/{id}', 'Detalle del grupo', 'GroupDetail');
route('post', '/groups/{id}/members', 'Unirse como miembro', 'Membership');
route('delete', '/groups/{id}/members/me', 'Salir del grupo', null, {
  status: 204,
  description: 'Último administrador: 409; transferir antes.',
});
route('get', '/groups/{id}/members', 'Listar miembros', 'MemberPage', {
  params: memberFilters,
  description: 'Requiere membresía; no expone correo.',
});
route(
  'patch',
  '/groups/{id}/members/{userId}',
  'Cambiar rol local',
  'Membership',
  {
    input: 'ChangeRole',
    description: 'Administrador local vigente; conservar al menos uno.',
  },
);
route('delete', '/groups/{id}/members/{userId}', 'Expulsar miembro', null, {
  status: 204,
  description: 'Administrador local vigente; conservar al menos uno.',
});
route('post', '/groups/{id}/transfer', 'Transferir administración', null, {
  status: 204,
  input: 'Transfer',
  description:
    'Administrador local a otro miembro; leave determina salida del actor.',
});
route('get', '/posts/{id}/comments', 'Conversación paginada', 'CommentPage', {
  access: 'optional',
  params: pagination,
  description:
    'Orden fecha/id descendente. Retenidos sólo para autor; retirados con hijos se muestran sin contenido.',
});
route('post', '/posts/{id}/comments', 'Comentar o responder', 'Comment', {
  input: 'CreateComment',
  params: [owner],
  description:
    'Publicación visible; membresía para escribir en grupo. Padre visible del mismo post.',
});
route('delete', '/comments/{id}', 'Retirar comentario', null, {
  status: 204,
  input: 'RemoveContent',
  params: [owner],
  description:
    'Observation obligatoria para retirar contenido ajeno; audita moderación.',
});
route('post', '/reports', 'Reportar un objetivo', 'ReportCreated', {
  input: 'CreateReport',
  params: [owner],
  description:
    'Exactamente postId o commentId; contenido visible y accesible. Duplicado 409.',
});
route('get', '/moderation/reports', 'Cola de reportes', 'ReportPage', {
  params: moderationFilters,
});
route('get', '/moderation/reports/{id}', 'Detalle de reporte', 'Report');
route('patch', '/moderation/reports/{id}', 'Resolver reporte', null, {
  status: 204,
  input: 'ResolveReport',
  params: [owner],
  description:
    'Global o moderación local del grupo. Suspender sólo global, nunca a sí mismo; suspensionDays obligatorio, observation máximo 500 para suspensión. Una resolución por reporte.',
});
route('get', '/moderation/retained', 'Cola de retenidos', 'RetainedPage', {
  params: moderationFilters,
});
route('patch', '/moderation/retained/{type}/{id}', 'Revisar retenido', null, {
  status: 204,
  input: 'Review',
  params: [owner],
  description:
    'Global o moderación local. version obligatoria para post; coincidencia requerida o 409. No restaura eliminados.',
});
route(
  'get',
  '/notifications',
  'Notificaciones de la cuenta',
  'NotificationPage',
  { params: [query('cursor'), query('unread', enumeration('true', 'false'))] },
);
route('get', '/notifications/unread/count', 'Contar sin leer', 'Count');
route('patch', '/notifications/read', 'Marcar leídas hasta ID', null, {
  status: 204,
  input: 'ReadThrough',
  description:
    'Sólo propias y con ID ≤ throughId; no consume avisos posteriores.',
});
route('patch', '/notifications/{id}/read', 'Marcar leída', null, {
  status: 204,
  description: 'Sólo propia; ajena 404.',
});
route('get', '/admin/summary', 'Resumen global', 'Summary', {
  params: [query('days', enumeration('7', '30'))],
  description:
    'Sólo administrador global. Ventana 7 por defecto. Posts/comments visibles creados en ventana; otros contadores son totales actuales.',
});
route('get', '/admin/users', 'Usuarios para administración', 'AdminUserPage', {
  params: [
    query('q', text(0, 254)),
    query('cursor'),
    query('role', enumeration('usuario', 'administrador')),
    query('status', enumeration('activo', 'suspendido')),
  ],
  description: 'Sólo administrador global.',
});
route('patch', '/admin/users/{id}/suspension', 'Suspender cuenta', null, {
  status: 204,
  input: 'Suspension',
  params: [owner],
  description:
    'Sólo administrador global activo; nunca a sí mismo. 1–90 días. No recibe until ni reportId.',
});
route('delete', '/admin/users/{id}/suspension', 'Reactivar cuenta', null, {
  status: 204,
  params: [owner],
  description: 'Sólo administrador global activo; elimina suspensión vigente.',
});
route(
  'get',
  '/admin/posts',
  'Inventario global de publicaciones',
  'AdminPostPage',
  {
    params: [
      query('q', text(0, 254)),
      query('cursor'),
      query('status', state),
      query('scope', enumeration('public', 'group')),
      query('categoryId', id),
    ],
    description:
      'Sólo administrador global. Retirar/revisar usa las rutas de posts/moderation; no existe PATCH admin/posts/status.',
  },
);
module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Blog estudiantil — contenido y comunidad',
    version: '1.0.0',
    description:
      'Contrato Nest local revisado 2026-11-10. Complementa auth.openapi.yaml del frontend; no implica Swagger runtime ni verificación del servidor remoto. Esquemas de entradas describen el formato recomendado; @IsOptional permite null en campos opcionales y existen validaciones semánticas de servicio descritas por operación. WebSocket /tiempo-real se documenta fuera de REST.',
  },
  servers: [{ url: '/api/v1' }],
  paths,
  components: {
    securitySchemes: {
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'jwt' },
    },
    schemas,
  },
};
if (require.main === module)
  require('node:fs').writeFileSync(
    `${__dirname}/content.openapi.json`,
    `${JSON.stringify(module.exports, null, 2)}\n`,
  );
