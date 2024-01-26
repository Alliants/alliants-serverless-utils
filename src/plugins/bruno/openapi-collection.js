import each from 'lodash/each.js'
import get from 'lodash/get.js'

import { hydrateSeqInCollection, transformItemsInCollection, uuid, validateSchema } from './utils.js'

function buildEmptyJsonBody(bodySchema, compoundName) {
  const _jsonBody = {}
  each(bodySchema.properties || {}, (prop, name) => {
    const fullName = [compoundName, name].filter(Boolean).join('.')
    if (prop.type === 'object') {
      _jsonBody[name] = buildEmptyJsonBody(prop, fullName)
    } else if (prop.type === 'array') {
      _jsonBody[name] = `{{${fullName}}}`
    } else {
      _jsonBody[name] = `{{${fullName}}}`
    }
  })
  return _jsonBody
}

function transformOpenapiRequestItem(request) {
  const _operationObject = request.operationObject

  let operationName = _operationObject.summary || _operationObject.operationId || _operationObject.description
  if (!operationName) {
    operationName = `${request.method} ${request.path}`
  }

  let requestPath = request.path.startsWith('/') ? request.path.slice(1) : request.path

  requestPath = requestPath
    .replace(/\{/g, '{{')
    .replace(/\}/g, '}}')

  const brunoRequestItem = {
    uid: uuid(),
    name: operationName,
    type: 'http-request',
    request: {
      url: `{{url}}/${requestPath}`,
      method: request.method.toUpperCase(),
      auth: {
        mode: 'none',
        basic: null,
        bearer: null,
        awsv4: null,
      },
      headers: [],
      params: [],
      body: {
        mode: 'none',
        json: null,
        text: null,
        xml: null,
        formUrlEncoded: [],
        multipartForm: [],
      },
    },
  }

  each(_operationObject.parameters || [], (param) => {
    if (param.in === 'query') {
      brunoRequestItem.request.params.push({
        uid: uuid(),
        name: param.name,
        value: `{{${param.name}}}`,
        description: param.description || '',
        enabled: param.required,
      })
    } else if (param.in === 'header') {
      brunoRequestItem.request.headers.push({
        uid: uuid(),
        name: param.name,
        value: `{{${param.name}}}`,
        description: param.description || '',
        enabled: param.required,
      })
    }
  })

  let auth
  // allow operation override
  if (_operationObject.security && _operationObject.security.length > 0) {
    const schemeName = Object.keys(_operationObject.security[0])[0]
    auth = request.global.security.getScheme(schemeName)
  } else if (request.global.security.supported.length > 0) {
    auth = request.global.security.supported[0]
  }

  if (auth) {
    if (auth.type === 'http' && auth.scheme === 'basic') {
      brunoRequestItem.request.auth.mode = 'basic'
      brunoRequestItem.request.auth.basic = {
        username: '{{username}}',
        password: '{{password}}',
      }
    } else if (auth.type === 'http' && auth.scheme === 'bearer') {
      brunoRequestItem.request.auth.mode = 'bearer'
      brunoRequestItem.request.auth.bearer = {
        token: '{{token}}',
      }
    } else if (auth.type === 'apiKey' && auth.in === 'header') {
      brunoRequestItem.request.headers.push({
        uid: uuid(),
        name: auth.name,
        value: '{{apiKey}}',
        description: 'Authentication header',
        enabled: true,
      })
    }
  }

  // TODO: handle allOf/anyOf/oneOf
  if (_operationObject.requestBody) {
    const content = get(_operationObject, 'requestBody.content', {})
    const mimeType = Object.keys(content)[0]
    const body = content[mimeType] || {}
    const bodySchema = body.schema
    if (mimeType === 'application/json') {
      brunoRequestItem.request.body.mode = 'json'
      if (bodySchema && bodySchema.type === 'object') {
        const _jsonBody = buildEmptyJsonBody(bodySchema)
        brunoRequestItem.request.body.json = JSON.stringify(_jsonBody, null, 2)
      }
    } else if (mimeType === 'application/x-www-form-urlencoded') {
      brunoRequestItem.request.body.mode = 'formUrlEncoded'
      if (bodySchema && bodySchema.type === 'object') {
        each(bodySchema.properties || {}, (prop, name) => {
          brunoRequestItem.request.body.formUrlEncoded.push({
            uid: uuid(),
            name,
            value: '',
            description: prop.description || '',
            enabled: true,
          })
        })
      }
    } else if (mimeType === 'multipart/form-data') {
      brunoRequestItem.request.body.mode = 'multipartForm'
      if (bodySchema && bodySchema.type === 'object') {
        each(bodySchema.properties || {}, (prop, name) => {
          brunoRequestItem.request.body.multipartForm.push({
            uid: uuid(),
            name,
            value: '',
            description: prop.description || '',
            enabled: true,
          })
        })
      }
    } else if (mimeType === 'text/plain') {
      brunoRequestItem.request.body.mode = 'text'
      brunoRequestItem.request.body.text = ''
    } else if (mimeType === 'text/xml') {
      brunoRequestItem.request.body.mode = 'xml'
      brunoRequestItem.request.body.xml = ''
    }
  }

  return brunoRequestItem
}

function resolveRefs(spec, components = spec.components, visitedItems = new Set()) {
  if (!spec || typeof spec !== 'object') {
    return spec
  }

  if (Array.isArray(spec)) {
    return spec.map(item => resolveRefs(item, components, visitedItems))
  }

  if ('$ref' in spec) {
    const refPath = spec.$ref

    if (visitedItems.has(refPath)) {
      return spec
    } else {
      visitedItems.add(refPath)
    }

    if (refPath.startsWith('#/components/')) {
      // Local reference within components
      const refKeys = refPath.replace('#/components/', '').split('/')
      let ref = components

      for (const key of refKeys) {
        if (ref[key]) {
          ref = ref[key]
        } else {
          // Handle invalid references gracefully?
          return spec
        }
      }

      return resolveRefs(ref, components, visitedItems)
    } else {
      // Handle external references (not implemented here)
      // You would need to fetch the external reference and resolve it.
      // Example: Fetch and resolve an external reference from a URL.
    }
  }

  // Recursively resolve references in nested objects
  for (const prop in spec) {
    spec[prop] = resolveRefs(spec[prop], components, visitedItems)
  }

  return spec
}

function groupRequestsByTags(requests) {
  const _groups = {}
  const ungrouped = []
  each(requests, (request) => {
    const tags = request.operationObject.tags || []
    if (tags.length > 0) {
      const tag = tags[0] // take first tag
      if (!_groups[tag]) {
        _groups[tag] = []
      }

      _groups[tag].push(request)
    } else {
      ungrouped.push(request)
    }
  })

  const groups = Object.keys(_groups).map((groupName) => {
    return {
      name: groupName,
      requests: _groups[groupName],
    }
  })

  return [groups, ungrouped]
}

function getDefaultUrl(serverObject) {
  let url = serverObject.url
  if (serverObject.variables) {
    each(serverObject.variables, (variable, variableName) => {
      const sub = variable.default || (variable.enum ? variable.enum[0] : `{{${variableName}}}`)
      url = url.replace(`{${variableName}}`, sub)
    })
  }
  return url
}

function getSecurity(apiSpec) {
  const defaultSchemes = apiSpec.security || []

  const securitySchemes = get(apiSpec, 'components.securitySchemes', {})
  if (Object.keys(securitySchemes) === 0) {
    return {
      supported: [],
    }
  }

  return {
    supported: defaultSchemes.map((scheme) => {
      const schemeName = Object.keys(scheme)[0]
      return securitySchemes[schemeName]
    }),
    schemes: securitySchemes,
    getScheme: (schemeName) => {
      return securitySchemes[schemeName]
    },
  }
}

function parseOpenApiCollection(data) {
  const brunoCollection = {
    name: '',
    uid: uuid(),
    version: '1',
    items: [],
    environments: [],
  }

  try {
    const collectionData = resolveRefs(data)
    if (!collectionData) {
      throw new Error('Invalid OpenAPI collection. Failed to resolve refs.')
    }

    // Currently parsing of openapi spec is "do your best", that is
    // allows "invalid" openapi spec

    // assumes v3 if not defined. v2 no supported yet
    if (collectionData.openapi && !collectionData.openapi.startsWith('3')) {
      throw new Error('Only OpenAPI v3 is supported currently.')
    }

    // TODO what if info.title not defined?
    brunoCollection.name = collectionData.info.title
    const servers = collectionData.servers || []
    const baseUrl = servers[0] ? getDefaultUrl(servers[0]) : ''
    const securityConfig = getSecurity(collectionData)

    const allRequests = Object.entries(collectionData.paths)
      .map(([path, methods]) => {
        return Object.entries(methods)
          .filter(([method]) => {
            return ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'].includes(
              method.toLowerCase(),
            )
          })
          .map(([method, operationObject]) => {
            return {
              method,
              path,
              operationObject,
              global: {
                server: baseUrl,
                security: securityConfig,
              },
            }
          })
      })
      .reduce((acc, val) => acc.concat(val), []) // flatten

    const [groups, ungroupedRequests] = groupRequestsByTags(allRequests)
    const brunoFolders = groups.map((group) => {
      return {
        uid: uuid(),
        name: group.name,
        type: 'folder',
        items: group.requests.map(transformOpenapiRequestItem),
      }
    })

    const ungroupedItems = ungroupedRequests.map(transformOpenapiRequestItem)
    const brunoCollectionItems = brunoFolders.concat(ungroupedItems)
    brunoCollection.items = brunoCollectionItems
    return brunoCollection
  } catch (err) {
    throw new Error('An error occurred while parsing the OpenAPI collection', err.message)
  }
}

async function importCollection(openapi) {
  return await validateSchema(
    hydrateSeqInCollection(
      transformItemsInCollection(
        parseOpenApiCollection(openapi),
      ),
    ),
  )
}

export default importCollection
