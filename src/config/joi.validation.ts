import * as Joi from 'joi';

const recoveryUrl = Joi.string()
  .uri({ scheme: ['https', 'http'] })
  .custom((value: string, helpers) => {
    const url = new URL(value);
    return url.username || url.password || url.search || url.hash
      ? helpers.error('any.invalid')
      : value;
  });

export const joiValidationSchema = Joi.object({
  PORT: Joi.number().default(2000),
  JWT_SECRET: Joi.string().required(),
  BFF_IDENTITY_SECRET: Joi.string().min(32),
  DATABASE_URL: Joi.string().required(),
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  SMTP_HOST: Joi.string(),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string(),
  SMTP_PASSWORD: Joi.string(),
  SMTP_FROM: Joi.string().email({ tlds: { allow: false } }),
  MAILER_SERVICE: Joi.string(),
  MAILER_EMAIL: Joi.string().email({ tlds: { allow: false } }),
  MAILER_SECRET_KEY: Joi.string(),
  RECOVERY_URL: recoveryUrl,
})
  .and('SMTP_HOST', 'SMTP_FROM')
  .with('SMTP_HOST', 'RECOVERY_URL')
  .and('SMTP_USER', 'SMTP_PASSWORD')
  .and('MAILER_SERVICE', 'MAILER_EMAIL', 'MAILER_SECRET_KEY')
  .with('MAILER_SERVICE', 'RECOVERY_URL')
  .when(
    Joi.object({ NODE_ENV: Joi.valid('production').required() }).unknown(),
    {
      then: Joi.object({
        JWT_SECRET: Joi.string().min(32).required(),
        RECOVERY_URL: recoveryUrl.uri({ scheme: ['https'] }).required(),
      }).or('MAILER_SERVICE', 'SMTP_HOST'),
    },
  );
