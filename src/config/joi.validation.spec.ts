import { joiValidationSchema } from './joi.validation';

describe('recovery configuration', () => {
  const base = {
    JWT_SECRET: 'synthetic-test-key',
    DATABASE_URL: 'postgresql://localhost/blog_test',
  };
  it.each([
    'https://user:password@example.test/recuperar',
    'https://example.test/recuperar?next=bad',
    'https://example.test/recuperar#fragment',
  ])('rejects unsafe recovery URL at startup: %s', (RECOVERY_URL) => {
    for (const NODE_ENV of ['development', 'production']) {
      expect(
        joiValidationSchema.validate({
          ...base,
          NODE_ENV,
          JWT_SECRET: 'synthetic-production-key-with-32-plus-characters',
          MAILER_SERVICE: 'gmail',
          MAILER_EMAIL: 'sender@example.test',
          MAILER_SECRET_KEY: 'synthetic-secret',
          RECOVERY_URL,
        }).error,
      ).toBeDefined();
    }
  });
  it('allows development without mail but rejects partial configuration', () => {
    expect(joiValidationSchema.validate(base).error).toBeUndefined();
    expect(
      joiValidationSchema.validate({ ...base, SMTP_HOST: 'localhost' }).error,
    ).toBeDefined();
  });
  it('accepts the local synthetic SMTP fixture', () => {
    expect(
      joiValidationSchema.validate({
        ...base,
        NODE_ENV: 'test',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: 11025,
        SMTP_FROM: 'test@example.test',
        RECOVERY_URL: 'http://localhost:3000/recuperar',
      }).error,
    ).toBeUndefined();
  });

  it('accepts complete MAILER configuration without SMTP variables', () => {
    expect(
      joiValidationSchema.validate({
        ...base,
        NODE_ENV: 'production',
        JWT_SECRET: 'synthetic-production-key-with-32-plus-characters',
        MAILER_SERVICE: 'gmail',
        MAILER_EMAIL: 'sender@example.test',
        MAILER_SECRET_KEY: 'synthetic-mail-secret',
        RECOVERY_URL: 'https://example.test/recuperar',
      }).error,
    ).toBeUndefined();
  });

  it.each(['MAILER_EMAIL', 'MAILER_SECRET_KEY', 'RECOVERY_URL'])(
    'rejects MAILER configuration missing %s',
    (missing) => {
      const config: Record<string, string> = {
        ...base,
        MAILER_SERVICE: 'gmail',
        MAILER_EMAIL: 'sender@example.test',
        MAILER_SECRET_KEY: 'synthetic-mail-secret',
        RECOVERY_URL: 'https://example.test/recuperar',
      };
      delete config[missing];
      expect(joiValidationSchema.validate(config).error).toBeDefined();
    },
  );
  it('requires mail and an HTTPS reset URL in production', () => {
    expect(
      joiValidationSchema.validate({ ...base, NODE_ENV: 'production' }).error,
    ).toBeDefined();
    expect(
      joiValidationSchema.validate({
        ...base,
        NODE_ENV: 'production',
        SMTP_HOST: 'smtp.example.com',
        SMTP_FROM: 'test@example.com',
        RECOVERY_URL: 'http://example.com/recuperar',
      }).error,
    ).toBeDefined();
  });
  it('rejects weak production signing keys and short BFF secrets', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      SMTP_HOST: 'smtp.example.test',
      SMTP_FROM: 'test@example.test',
      RECOVERY_URL: 'https://example.test/recuperar',
    };
    expect(joiValidationSchema.validate(production).error).toBeDefined();
    expect(
      joiValidationSchema.validate({
        ...production,
        JWT_SECRET: 'synthetic-production-key-with-32-plus-characters',
      }).error,
    ).toBeUndefined();
    expect(
      joiValidationSchema.validate({ ...base, BFF_IDENTITY_SECRET: 'short' })
        .error,
    ).toBeDefined();
  });
});
