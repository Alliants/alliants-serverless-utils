import { ERRORS } from '../utils/errors.js'
import { Joi } from './validator.js'

const ErrorLocalSchema = Joi.object({
  error: Joi.string().example(ERRORS.AUTH.INVALID_CREDENTIALS.code).label('Error Code'),
  message: Joi.string().example(ERRORS.AUTH.INVALID_CREDENTIALS.message).label('Error Message'),
  statusCode: Joi.number().integer().example(401).label('HTTP Code'),
})

const ErrorResponse = Joi.object({
  code: Joi.string().example(ERRORS.PARAMS.INVALID_JSON_BODY.code).label('Error Code'),
  message: Joi.string().example(ERRORS.PARAMS.INVALID_JSON_BODY.message).label('Error Message'),
  statusCode: Joi.number().integer().example(400).label('HTTP Code'),
  info: Joi.object({
    errors: Joi.array().items(Joi.object({
      message: Joi.string().label('Error Message'),
      field: Joi.string().label('Field'),
      path: Joi.array().items(Joi.alternatives().try(Joi.string(), Joi.number())).label('Path'),
      type: Joi.string().label('Type'),
      context: Joi.object({
        child: Joi.string().label('Child'),
        regex: Joi.object().label('Regex'),
        limit: Joi.number().label('Limit'),
        key: Joi.alternatives().try(Joi.string(), Joi.number()).label('Key').allow(null),
        label: Joi.string().label('Label').allow(null),
        valids: Joi.array().items(Joi.string()).label('Valid Values'),
        invalids: Joi.array().items(Joi.string()).label('Invalid Values'),
        value: Joi.alternatives().try(Joi.string(), Joi.number(), Joi.object(), Joi.boolean(), Joi.array()).allow(null).label('Value'),
        name: Joi.string().label('Name'),
      }).label('Context'),
      // is enum
      paramType: Joi.string().valid('body', 'queryParams', 'pathParams', 'cookieParams', 'requestHeaders').label('Param Type'),
    })),
  }),
})

const NotFoundResponse = Joi.object({
  code: Joi.string().example(ERRORS.AUTH.USER_NOT_FOUND.code).label('Error Code'),
  message: Joi.string().example(ERRORS.AUTH.USER_NOT_FOUND.message).label('Error Message'),
  statusCode: Joi.number().integer().example(404).label('HTTP Code'),
})

const ServerErrorResponse = Joi.object({
  code: Joi.string().example(ERRORS.DEFAULT.INTERNAL.code).label('Error Code'),
  message: Joi.string().example(ERRORS.DEFAULT.INTERNAL.message).label('Error Message'),
  statusCode: Joi.number().integer().example(500).label('HTTP Code'),
})

const UnauthorizedResponse = Joi.object({
  code: Joi.string().example(ERRORS.AUTH.INVALID_CREDENTIALS.code).label('Error Code'),
  message: Joi.string().example(ERRORS.AUTH.INVALID_CREDENTIALS.message).label('Error Message'),
  statusCode: Joi.number().integer().example(401).label('HTTP Code'),
})

const ForbiddenResponse = Joi.object({
  code: Joi.string().example(ERRORS.AUTH.INVALID_CREDENTIALS.code).label('Error Code'),
  message: Joi.string().example(ERRORS.AUTH.INVALID_CREDENTIALS.message).label('Error Message'),
  statusCode: Joi.number().integer().example(403).label('HTTP Code'),
})

const RateLimitedResponse = Joi.object({
  code: Joi.string().example(ERRORS.DEFAULT.RATE_LIMITED.code).label('Error Code'),
  message: Joi.string().example(ERRORS.DEFAULT.RATE_LIMITED.message).label('Error Message'),
  statusCode: Joi.number().integer().example(429).label('HTTP Code'),
})

export {
  ErrorLocalSchema,
  ErrorResponse,
  ForbiddenResponse,
  NotFoundResponse,
  RateLimitedResponse,
  ServerErrorResponse,
  UnauthorizedResponse,
}
