import { generateErrorResponses } from '../schemas/common.js'
import { Joi } from '../schemas/validator.js'

const documentation = {
  summary: 'Hello 3',
  tags: ['Hello Two Section'],
  description: 'Hello 3 template.',
  methodResponses: [
    {
      statusCode: 200,
      responseBody: {
        description: 'An object returning hello3 request body.',
      },
      responseModels: {
        'application/json': 'HelloThreeSchema',
      },
    },
    ...generateErrorResponses([400, 401, 404, 500], 'getting getting hello 3'),
  ],
  requestBody: {
    description: 'Heelo 3 request body',
    content: {
      'application/json': {
        examples: {
          Example1: {
            summary: 'Example 1',
            value: {
              hello3: 'some-example-1'
            }
          },
          Example2: {
            summary: 'Example 2',
            value: {
              hello3: 'some-example-2'
            }
          },
        }
      }
    }
  }
}

const schema = {
  response: Joi.object({
    hello3: Joi.string().required(),
  }),
  body: Joi.object({
    hello3: Joi.string().required(),
  }),
}

const handler = async (event) => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      hello3: event.body.hello3,
    }),
  }
}

export { documentation, handler, schema }
