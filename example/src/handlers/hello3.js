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
        description: 'An object returning hello3 response body.',
        content: {
          'application/json': {
            examples: {
              ResponseExample1: {
                summary: 'Response Example 1',
                value: {
                  hello3: 'response-example-1',
                },
              },
              ResponseExample2: {
                summary: 'Response Example 2',
                value: {
                  hello3: 'response-example-2',
                },
              },
            },
          },
        },
      },
      responseModels: {
        'application/json': 'HelloThreeSchema',
      },
    },
    ...generateErrorResponses([400, 401, 404, 500], 'getting getting hello 3'),
  ],
  requestBody: {
    description: 'Hello 3 request body',
    content: {
      'application/json': {
        examples: {
          RequestExample1: {
            summary: 'RequestExample 1',
            value: {
              hello3: 'request-example-1',
            },
          },
          RequestExample2: {
            summary: 'Request Example 2',
            value: {
              hello3: 'request-example-2',
            },
          },
        },
      },
    },
  },
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
