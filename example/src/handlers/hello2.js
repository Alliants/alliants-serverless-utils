import { generateErrorResponses } from '../schemas/common.js'
import { Joi } from '../schemas/validator.js'

const documentation = {
  summary: 'Hello 2',
  tags: ['Hello Two Section'],
  description: 'Hello 2 template.',
  methodResponses: [
    {
      statusCode: 200,
      responseBody: {
        description: 'An object returning hello2: true.',
      },
      responseModels: {
        'application/json': 'HelloTwoSchema',
      },
    },
    ...generateErrorResponses([400, 401, 404, 500], 'getting getting hello 2'),
  ],
}

const schema = {
  params: Joi.object({
    name: Joi.string().required(),
  }),
  queryParams: Joi.object({
    test: Joi.string().required(),
  }),
  response: Joi.object({
    hello2: Joi.string().required(),
  }),
}

const handler = async (event) => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      hello2: event.pathParameters.name,
    }),
  }
}

export { documentation, handler, schema }
