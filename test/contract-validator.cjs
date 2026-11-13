const assert = require('node:assert/strict');
const Ajv = require('ajv');
const contract = require('../docs/contracts/content.openapi.json');
const ajv = new Ajv({
  allErrors: true,
  nullable: true,
  unknownFormats: ['binary'],
});
const validators = new Map();
function validateSchema(schema, value, context) {
  const key = JSON.stringify(schema);
  if (!validators.has(key))
    validators.set(
      key,
      ajv.compile({ ...schema, components: contract.components }),
    );
  const validate = validators.get(key);
  assert(validate(value), `${context}: ${ajv.errorsText(validate.errors)}`);
}
// Prefer literal paths to parameterized paths, as Nest does for these routes.
const routes = Object.entries(contract.paths).sort(
  ([a], [b]) => (a.match(/\{/g)?.length ?? 0) - (b.match(/\{/g)?.length ?? 0),
);
const captured = new Map();
function assertResponse(method, path, status, body, capture = false) {
  const pathname = path.split('?')[0];
  const match = routes.find(
    ([template, methods]) =>
      methods[method] &&
      new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(pathname),
  );
  if (!match) return; // Auth/profile live in the separate existing contract.
  const [template, methods] = match;
  const operation = methods[method];
  assert(
    status >= 400 || operation.responses[status],
    `Undocumented success ${method} ${template}: ${status}`,
  );
  const response = operation.responses[status] ?? operation.responses.default;
  const schema = response.content?.['application/json']?.schema;
  if (schema) validateSchema(schema, body, `${method} ${template} ${status}`);
  else if (status === 204)
    assert(
      body == null || Object.keys(body).length === 0,
      '204 must not contain JSON',
    );
  if (capture && (schema || status === 204)) {
    const key = `${method} ${template} ${status}`;
    // Only synthetic SQL/HTTP test data calls this branch. No headers/cookies recorded.
    if (!captured.has(key))
      captured.set(key, { method, path: template, status, body });
  }
}
function writeCaptured(path) {
  const fs = require('node:fs');
  fs.mkdirSync(require('node:path').dirname(path), { recursive: true });
  fs.writeFileSync(
    path,
    `${JSON.stringify({ provenance: 'Synthetic isolated PostgreSQL + real Nest HTTP responses. No credentials or headers.', responses: [...captured.values()] }, null, 2)}\n`,
  );
}
module.exports = { assertResponse, validateSchema, writeCaptured, contract };
