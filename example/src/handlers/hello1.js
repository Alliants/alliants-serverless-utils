import { generateErrorResponses } from '../schemas/common.js'
import { Joi } from '../schemas/validator.js'

const documentation = {
  summary: 'Hello 1',
  tags: ['Hello One Section'],
  description: 'Hello 1 template.',
  methodResponses: [
    {
      statusCode: 200,
      responseBody: {
        description: 'An object returning hello1: true.',
      },
      responseModels: {
        'application/json': 'HelloOneSchema',
      },
    },
    ...generateErrorResponses([400, 401, 404, 500], 'getting hello 1'),
  ],
}

const schema = {
  response: Joi.object({
    hello1: Joi.boolean().required(),
  }),
  queryParams: Joi.object({
    page: Joi.number(),
  }),
}

const handler = async () => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      hello1: true,
    }),
  }
}

export { documentation, handler, schema }
