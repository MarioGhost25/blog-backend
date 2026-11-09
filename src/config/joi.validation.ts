import * as Joi from 'joi';

export const joiValidationSchema = Joi.object({
  PORT: Joi.number().default(2000),
  JWT_SECRET: Joi.string().required(),
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
  RECOVERY_URL: Joi.string().uri({ scheme: ['https', 'http'] }),
})
  .and('SMTP_HOST', 'SMTP_FROM', 'RECOVERY_URL')
  .and('SMTP_USER', 'SMTP_PASSWORD')
  .when(
    Joi.object({ NODE_ENV: Joi.valid('production').required() }).unknown(),
    {
      then: Joi.object({
        SMTP_HOST: Joi.required(),
        SMTP_FROM: Joi.required(),
        RECOVERY_URL: Joi.string()
          .uri({ scheme: ['https'] })
          .required(),
      }),
    },
  );
