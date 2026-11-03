import * as Joi from 'joi';

export const joiValidationSchema = Joi.object({
  PORT: Joi.number().default(2000),
  PG_PORT: Joi.number().default(2002),
  DB_NAME: Joi.required(),
  DB_PASSWORD: Joi.required(),
  DB_USERNAME: Joi.required(),
  JWT_SECRET: Joi.string().required(),
  DATABASE_URL: Joi.string().required(),
});
