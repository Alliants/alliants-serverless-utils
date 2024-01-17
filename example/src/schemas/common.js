/**
 * Returns a list of error responses for an endpoint
 * @param {number[]} statusCodes  - list of error responses
 * @param {string} when - description
 * @returns {object[]}
 */
function generateErrorResponses(statusCodes, when) {
  const responses = []
  const postText = 'The examples show all possible `code` and `message` values, not limited to this endpoint.'
  if (statusCodes.includes(400)) {
    responses.push({
      statusCode: 400,
      responseBody: {
        description: `An error message when ${when}. ${postText}`,
      },
      responseModels: {
        'application/json': 'ErrorResponse',
      },
    })
  }

  if (statusCodes.includes(401)) {
    responses.push({
      statusCode: 401,
      responseBody: {
        description: `Unauthorised user when ${when}. ${postText}`,
      },
      responseModels: {
        'application/json': 'UnauthorizedResponse',
      },
    })
  }

  if (statusCodes.includes(403)) {
    responses.push({
      statusCode: 403,
      responseBody: {
        description: `Forbidden when ${when}. ${postText}`,
      },
      responseModels: {
        'application/json': 'ForbiddenResponse',
      },
    })
  }

  if (statusCodes.includes(404)) {
    responses.push({
      statusCode: 404,
      responseBody: {
        description: `Resource not found when ${when}. ${postText}`,
      },
      responseModels: {
        'application/json': 'NotFoundResponse',
      },
    })
  }

  if (statusCodes.includes(429)) {
    responses.push({
      statusCode: 429,
      responseBody: {
        description: `Rate limited when ${when}. ${postText}`,
      },
      responseModels: {
        'application/json': 'RateLimitedResponse',
      },
    })
  }

  if (statusCodes.includes(500)) {
    responses.push({
      statusCode: 500,
      responseBody: {
        description: `A server error when ${when}. ${postText}`,
      },
      responseModels: {
        'application/json': 'ServerErrorResponse',
      },
    })
  }

  return responses
}

export {
  generateErrorResponses,
}
