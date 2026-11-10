import { joiValidationSchema } from './joi.validation';

describe('recovery configuration', () => {
  const base = {
    JWT_SECRET: 'synthetic-test-key',
    DATABASE_URL: 'postgresql://localhost/blog_test',
  };
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
