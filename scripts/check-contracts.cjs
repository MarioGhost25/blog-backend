const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const {
  contract,
  assertResponse,
  validateSchema,
} = require('../test/contract-validator.cjs');
const source = require('../docs/contracts/content.openapi.cjs');
assert.deepEqual(
  contract,
  source,
  'Regenerate JSON with npm run contracts:generate',
);
const ids = new Set();
let operations = 0;
for (const [route, methods] of Object.entries(contract.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    operations++;
    assert(!ids.has(operation.operationId), 'Duplicate operationId');
    ids.add(operation.operationId);
    const params = operation.parameters.filter((p) => p.in === 'path');
    assert.deepEqual(
      params.map((p) => p.name).sort(),
      [...route.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort(),
    );
    assert(params.every((p) => p.required));
    if (operation.responses[204]) assert(!operation.responses[204].content);
    assert(operation.responses.default);
  }
}
function walk(value) {
  if (!value || typeof value !== 'object') return;
  if (value.$ref) {
    assert(value.$ref.startsWith('#/'), 'Only local references supported');
    let target = contract;
    for (const key of value.$ref.slice(2).split('/')) target = target?.[key];
    assert(target, `Broken reference ${value.$ref}`);
  }
  Object.values(value).forEach(walk);
}
walk(contract);
const inventory = new Set();
const files = [
  'categories/categories',
  'posts/posts',
  'posts/personal-feed',
  'groups/groups',
  'comments/comments',
  'moderation/moderation',
  'notifications/notifications',
  'admin/admin',
  'users/users',
];
const decorators = (node) =>
  ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
const call = (decorator) =>
  ts.isCallExpression(decorator.expression) ? decorator.expression : null;
for (const file of files) {
  const filename = path.join(__dirname, '../src', `${file}.controller.ts`);
  const ast = ts.createSourceFile(
    filename,
    fs.readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  for (const node of ast.statements.filter(ts.isClassDeclaration)) {
    const controller = decorators(node)
      .map(call)
      .find((c) => c?.expression.getText(ast) === 'Controller');
    if (!controller) continue;
    const prefix = controller.arguments[0]?.text ?? '';
    for (const member of node.members)
      for (const decoration of decorators(member)) {
        const c = call(decoration);
        if (
          !c ||
          !['Get', 'Post', 'Patch', 'Delete', 'Put'].includes(
            c.expression.getText(ast),
          )
        )
          continue;
        const method = c.expression.getText(ast).toLowerCase();
        const route =
          '/' +
          [prefix, c.arguments[0]?.text ?? '']
            .filter(Boolean)
            .join('/')
            .replace(/:([\w]+)/g, '{$1}');
        if (file === 'users/users' && route !== '/users/me/posts') continue;
        inventory.add(`${method} ${route}`);
        assert(
          contract.paths[route]?.[method],
          `Missing controller operation: ${method} ${route}`,
        );
      }
  }
}
assert.equal(
  inventory.size,
  operations,
  'Documented operation does not exist in selected controllers',
);
// Validate schemas compile, not only those exercised in fixtures.
const Ajv = require('ajv');
const ajv = new Ajv({ nullable: true, unknownFormats: ['binary'] });
for (const name of Object.keys(contract.components.schemas))
  ajv.compile({
    $ref: `#/components/schemas/${name}`,
    components: contract.components,
  });
const fixtureFile = path.join(
  __dirname,
  '../docs/contracts/http-fixtures.json',
);
assert(fs.existsSync(fixtureFile), 'Missing captured HTTP fixtures');
const fixtures = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
for (const fixture of fixtures.responses)
  assertResponse(fixture.method, fixture.path, fixture.status, fixture.body);
for (const [route, methods] of Object.entries(contract.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (
      Object.entries(operation.responses).some(
        ([status, response]) =>
          Number(status) < 300 && response.content?.['application/json'],
      )
    ) {
      assert(
        fixtures.responses.some(
          (f) => f.path === route && f.method === method && f.status < 300,
        ),
        `Missing captured success for ${method} ${route}`,
      );
    }
  }
}
const frontendCopy = path.join(
  __dirname,
  '../../blog-frontend/postman/contracts/community-http-fixtures.json',
);
if (fs.existsSync(frontendCopy))
  assert.deepEqual(
    JSON.parse(fs.readFileSync(frontendCopy, 'utf8')),
    fixtures,
    'Frontend fixture copy is stale',
  );
const sample = fixtures.responses.find(
  (f) => f.path === '/posts/{id}' && f.status === 200,
).body;
validateSchema(
  { $ref: '#/components/schemas/PostDetail' },
  { ...sample, updatedAt: null },
  'nullable updatedAt',
);
assert.throws(() =>
  validateSchema(
    { $ref: '#/components/schemas/PostDetail' },
    { ...sample, id: 1 },
    'numeric output ID',
  ),
);
assert.throws(() =>
  validateSchema(
    { $ref: '#/components/schemas/PostDetail' },
    { ...sample, cloudinaryPublicId: 'internal' },
    'provider leak',
  ),
);
assert.throws(() =>
  validateSchema(
    { $ref: '#/components/schemas/CreateReport' },
    { postId: '1', commentId: '2', reason: 'Example' },
    'two report targets',
  ),
);
for (const role of ['member', 'moderator', 'administrator'])
  validateSchema(
    { $ref: '#/components/schemas/ChangeRole' },
    { role },
    'known role',
  );
assert.throws(() =>
  validateSchema(
    { $ref: '#/components/schemas/ChangeRole' },
    { role: 'owner' },
    'unknown role',
  ),
);
console.log(
  `PASS contracts: ${operations} controller operations, ${Object.keys(contract.components.schemas).length} schemas, ${fixtures.responses.length} captured HTTP fixtures; references, nullable fields, IDs, roles and output minimization.`,
);
