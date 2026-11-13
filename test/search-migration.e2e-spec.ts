import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Deliberately never read DATABASE_URL or dotenv. This suite creates only its
// own random schema in an explicitly designated local disposable database.
describe('generated Spanish search migration', () => {
  const schema = `audit_test_${randomBytes(12).toString('hex')}`;
  let created = false;
  let connection: URL;

  function sql(statement: string): string {
    return execFileSync(
      'psql',
      ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
      {
        env: {
          ...process.env,
          PGHOST: connection.hostname,
          PGPORT: connection.port || '5432',
          PGDATABASE: connection.pathname.slice(1),
          PGUSER: decodeURIComponent(connection.username),
          PGPASSWORD: decodeURIComponent(connection.password),
          PGOPTIONS: `-c search_path=${schema}`,
          PGCONNECT_TIMEOUT: '5',
        },
        input: statement,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 20000,
      },
    ).trim();
  }

  beforeAll(() => {
    const target = process.env.TEST_DATABASE_URL;
    if (!target)
      throw new Error(
        'Set TEST_DATABASE_URL to a disposable local database ending in _test',
      );
    connection = new URL(target);
    if (
      !['postgres:', 'postgresql:'].includes(connection.protocol) ||
      !['localhost', '127.0.0.1'].includes(connection.hostname) ||
      !/^\/[a-zA-Z0-9_]+_test$/.test(connection.pathname) ||
      connection.search ||
      connection.hash ||
      !connection.username
    ) {
      throw new Error('Refusing a non-local or non-test database');
    }
    sql(`CREATE SCHEMA ${schema}`);
    created = true;
    sql(
      readFileSync(
        resolve('prisma/migrations/20261016223549_init/migration.sql'),
        'utf8',
      ),
    );
    sql(`INSERT INTO usuario (nombre, apellido, correo, contrasena_hash)
      VALUES ('Synthetic', 'Test', 'migration@example.test', 'not-a-login-hash');
      INSERT INTO categoria (nombre) VALUES ('Pruebas');
      INSERT INTO publicacion (id_autor,id_categoria,titulo,contenido)
      VALUES (1,1,'Álgebra universitaria','Matrices y determinantes');`);
    sql(
      readFileSync(
        resolve(
          'prisma/migrations/20261108000100_generated_search/migration.sql',
        ),
        'utf8',
      ),
    );
  });

  afterAll(() => {
    if (created) sql(`DROP SCHEMA ${schema} CASCADE`);
  });

  it('installs all thirteen business constraints on existing valid data', () => {
    sql(
      readFileSync(
        resolve(
          'prisma/migrations/20261108000200_business_checks/migration.sql',
        ),
        'utf8',
      ),
    );
    expect(
      sql(
        `SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='${schema}' AND c.contype='c' AND c.conname LIKE 'ck_%'`,
      ),
    ).toBe('13');
  });

  const invalid: Array<[string, string]> = [
    [
      'ck_suspension_coherente',
      "UPDATE usuario SET estado='suspendido' WHERE id_usuario=1",
    ],
    [
      'ck_foto_completa',
      "UPDATE usuario SET foto_url='https://example.test/photo' WHERE id_usuario=1",
    ],
    [
      'ck_no_autosuspension',
      "UPDATE usuario SET estado='suspendido',suspendido_hasta=now(),motivo_suspension='test',suspendido_por=1 WHERE id_usuario=1",
    ],
    [
      'ck_correo_minusculas',
      "UPDATE usuario SET correo='UPPER@example.test' WHERE id_usuario=1",
    ],
    [
      'ck_publicacion_titulo',
      "UPDATE publicacion SET titulo='a' WHERE id_publicacion=1",
    ],
    [
      'ck_publicacion_version',
      'UPDATE publicacion SET version=0 WHERE id_publicacion=1',
    ],
    [
      'ck_archivo_en_cloudinary',
      "INSERT INTO adjunto(id_publicacion,tipo,titulo,url,orden) VALUES(1,'imagen','test','https://example.test',1)",
    ],
    [
      'ck_adjunto_orden',
      "INSERT INTO adjunto(id_publicacion,tipo,titulo,url,orden) VALUES(1,'enlace','test','https://example.test',0)",
    ],
    [
      'ck_no_autorespuesta',
      "INSERT INTO comentario(id_comentario,id_publicacion,id_autor,id_comentario_padre,contenido) VALUES(999,1,1,999,'test')",
    ],
    [
      'ck_reporte_un_objetivo',
      "INSERT INTO reporte(id_reportante,motivo) VALUES(1,'test reason')",
    ],
    [
      'ck_reporte_resuelto',
      "INSERT INTO reporte(id_reportante,id_publicacion,motivo,estado) VALUES(1,1,'test reason','desestimado')",
    ],
    [
      'ck_notificacion_una_referencia',
      "INSERT INTO notificacion(id_destinatario,tipo,mensaje) VALUES(1,'contenido_retirado','test')",
    ],
    [
      'ck_notificacion_tipo',
      "INSERT INTO notificacion(id_destinatario,tipo,mensaje,id_publicacion) VALUES(1,'comentario','test',1)",
    ],
  ];
  it.each(invalid)(
    'rejects violations of %s in PostgreSQL',
    (constraint, statement) => {
      let rejected = false;
      try {
        sql(statement);
      } catch (error: unknown) {
        rejected = String((error as { stderr?: unknown }).stderr).includes(
          constraint,
        );
      }
      expect(rejected).toBe(true);
    },
  );

  it('backfills existing publications and creates the GIN index', () => {
    expect(
      sql(
        "SELECT count(*) FROM publicacion WHERE busqueda @@ plainto_tsquery('spanish','matrices')",
      ),
    ).toBe('1');
    expect(
      sql(
        `SELECT is_generated FROM information_schema.columns WHERE table_schema='${schema}' AND table_name='publicacion' AND column_name='busqueda'`,
      ),
    ).toBe('ALWAYS');
    expect(
      sql(
        `SELECT indexdef FROM pg_indexes WHERE schemaname='${schema}' AND indexname='ix_publicacion_busqueda'`,
      ),
    ).toContain('USING gin');
  });

  it('updates the vector after edits and new inserts without manual indexing', () => {
    sql(
      "UPDATE publicacion SET titulo='Geometría', contenido='Triángulos' WHERE id_publicacion=1",
    );
    expect(
      sql(
        "SELECT count(*) FROM publicacion WHERE busqueda @@ plainto_tsquery('spanish','matrices')",
      ),
    ).toBe('0');
    expect(
      sql(
        "SELECT count(*) FROM publicacion WHERE busqueda @@ plainto_tsquery('spanish','triángulo')",
      ),
    ).toBe('1');
    sql(
      "INSERT INTO publicacion (id_autor,id_categoria,titulo,contenido) VALUES (1,1,'Programación','Algoritmos recursivos')",
    );
    expect(
      sql(
        "SELECT count(*) FROM publicacion WHERE busqueda @@ plainto_tsquery('spanish','algoritmo')",
      ),
    ).toBe('1');
  });
});
