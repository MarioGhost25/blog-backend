import * as Joi from 'joi';

export const joiValidationSchema = Joi.object({
  PORT: Joi.number().default(2000),
  JWT_SECRET: Joi.string().required(),
  DATABASE_URL: Joi.string().required(),
});
