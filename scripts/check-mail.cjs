const path = require('node:path');

async function main() {
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  require('ts-node').register({
    transpileOnly: true,
    compilerOptions: {
      module: 'CommonJS',
      moduleResolution: 'node',
      resolvePackageJsonExports: false,
    },
  });
  const { ConfigService } = require('@nestjs/config');
  const { joiValidationSchema } = require('../src/config/joi.validation.ts');
  const { MailService } = require('../src/mail/mail.service.ts');
  const result = joiValidationSchema.validate(process.env, {
    allowUnknown: true,
    abortEarly: false,
  });
  if (result.error) {
    // Never print Joi's context: it can contain credentials.
    throw new Error('CONFIG');
  }
  await new MailService(new ConfigService(result.value)).verifyConnection();
  console.log(
    'OK: conexión SMTP y autenticación verificadas. No se envió correo.',
  );
  console.log(
    'Probá la entrega desde http://localhost:3000/recuperar con una cuenta registrada.',
  );
}

main().catch((error) => {
  const code = error?.code;
  if (code === 'EAUTH') {
    console.error(
      'Falló la autenticación. Revisá MAILER_EMAIL y MAILER_SECRET_KEY; Gmail requiere una contraseña de aplicación.',
    );
  } else if (
    ['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS', 'ECONNREFUSED'].includes(
      code,
    )
  ) {
    console.error(
      'No se pudo conectar al servidor SMTP. Revisá la red, el proveedor y el acceso al puerto SMTP.',
    );
  } else {
    console.error(
      'No se pudo verificar el correo. Revisá las variables MAILER_* y RECOVERY_URL, y las dependencias instaladas.',
    );
  }
  process.exitCode = 1;
});
