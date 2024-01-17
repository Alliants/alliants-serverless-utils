export const APPLICATION_ERRORS = {
  SYSTEM: { // 000 range
    GENERIC_ERROR: { code: 'TR000', message: 'An error occurred', statusCode: 500 },
  },
}

export const ERRORS = {
  DEFAULT: {
    INTERNAL: { code: 'DE000', message: 'Unexpected error', statusCode: 500 },
    DEFAULT_4XX: { code: 'DE001', message: 'Unexpected error (4XX)', statusCode: 400 }, // used for API Gateway responses
    DEFAULT_5XX: { code: 'DE002', message: 'Unexpected error (5XX)', statusCode: 500 }, // used for API Gateway responses
    TIMEOUT: { code: 'DE003', message: 'Request timed out', statusCode: 504 }, // used for API Gateway responses
    RATE_LIMITED: { code: 'DE004', message: 'Rate limited', statusCode: 429 }, // used for API Gateway responses
    NOT_FOUND: { code: 'DE006', message: 'Page not found', statusCode: 404 }, // used for API Gateway responses
    OPERATION_FAILED: { code: 'DE007', message: 'Operation failed', statusCode: 500 },
    CONNECTION_FAILED: { code: 'DE008', message: 'Connection failed', statusCode: 500 },
    ITEM_NOT_FOUND: { code: 'DE009', message: 'Item not found', statusCode: 404 },
  },
  PARAMS: {
    DEFAULT: { code: 'PA001', message: 'Parameter error', statusCode: 400 },
    MISSING: { code: 'PA002', message: 'Parameter missing', statusCode: 400 },
    INVALID_JSON_BODY: { code: 'PA003', message: 'Body is invalid JSON string', statusCode: 400 },
    REQUEST_BODY_MISSING: { code: 'PA004', message: 'Request body missing or empty', statusCode: 400 },
    VALIDATION_FAILED_MORE_INFO: { code: 'PA005', message: 'Validation failed - see info for more details', statusCode: 400 },
    ALREADY_EXISTS: { code: 'PA007', message: 'Already exists', statusCode: 400 },
  },
  AUTH: {
    USER_NOT_FOUND: { code: 'AU001', message: 'User not found', statusCode: 404 },
    INVALID_CREDENTIALS: { code: 'AU002', message: 'Invalid credentials', statusCode: 401 },
    ACCESS_DENIED: { code: 'AU014', message: 'Access denied', statusCode: 403 }, // used for API Gateway responses
  },
  DATABASE: {
    CONNECT: { code: 'DB001', message: 'Error connecting to the database', statusCode: 500 },
    DELETE: { code: 'DB002', message: 'Error deleting from the database', statusCode: 500 },
    INSERT: { code: 'DB003', message: 'Error inserting to the database', statusCode: 500 },
    QUERY: { code: 'DB004', message: 'Error querying the database', statusCode: 500 },
    UPDATE: { code: 'DB005', message: 'Error updating the database', statusCode: 500 },
    ERROR: { code: 'DB006', message: 'Error with the database', statusCode: 500 },
    UPSERT: { code: 'DB007', message: 'Error upserting to the database', statusCode: 500 },
  },
}
