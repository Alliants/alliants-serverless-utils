import fs from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

import SwaggerParser from '@apidevtools/swagger-parser'
import { DefinitionGenerator } from '@motymichaely/serverless-openapi-documentation/dist/DefinitionGenerator.js'
import j2s from 'joi-to-swagger'
import json2yml from 'json-to-pretty-yaml'
import camelcase from 'lodash/camelCase.js'

// loaded from serverless.yml configuration
let globalSchemas
let APPLICATION_ERRORS
let ERRORS

const toJSONSchema = schema => j2s(schema).swagger

function getServerlessDocumentation(serverless) {
  const { custom, functions: allFunctions } = serverless.configurationInput
  const functions = []

  Object
    .keys(allFunctions)
    .forEach((name) => {
      const func = allFunctions[name]
      const event = func?.events?.find(e => e.http)
      if (event?.http) {
        const { http } = event
        functions.push({
          _functionName: name,
          name: camelcase(name),
          handler: func.handler,
          events: [
            {
              http: {
                path: http.path,
                method: http.method,
              },
            },
          ],
        })
      }
    })

  return {
    custom: custom.documentation,
    functions,
  }
}

function addParams(schema, doc, type) {
  if (!schema[type]) {
    return
  }

  schema = toJSONSchema(schema[type])
  const params = []
  Object.keys(schema.properties).forEach((prop) => {
    const {
      description,
      style,
      explode,
      ...propSchema
    } = schema.properties[prop]

    const param = {
      name: prop,
      schema: propSchema,
      required: schema.required?.includes(prop),
    }

    if (description) {
      param.description = description
    }

    if (style) {
      param.style = style
    }

    if (explode) {
      param.explode = explode
    }

    params.push(param)
  })

  doc[type] = params
}

function createModel(schema, name) {
  const schemaExamples = schema.example ? [schema.example] : schema.examples

  delete schema.example

  delete schema.examples

  let examples
  if (schemaExamples) {
    examples = {}
    schemaExamples.forEach((example) => {
      const { title, ...value } = example
      if (title) {
        examples[example.title] = value
      }
    })
  }

  // Delete any title as we want the schema name to show up in the documentation

  delete schema.title

  return {
    name,
    contentType: 'application/json',
    schema,
    examples,
  }
}

export async function buildDocumentation(serverless) {
  const documentation = getServerlessDocumentation(serverless)

  if (documentation?.custom?.schemasPath) {
    globalSchemas = await import(resolve(documentation?.custom?.schemasPath))
  } else {
    throw new Error('missing `schemasPath` property in documentation configuration')
  }

  if (documentation?.custom?.errorsPath) {
    const allErrors = await import(resolve(documentation?.custom?.errorsPath))
    APPLICATION_ERRORS = allErrors.APPLICATION_ERRORS
    ERRORS = allErrors.ERRORS
  } else {
    throw new Error('missing `errorsPath` property in documentation configuration')
  }

  documentation.custom.models = []

  for (const func of documentation.functions) {
    const handlerPath = resolve(process.cwd(), `${func.handler.slice(0, func.handler.indexOf('.'))}.js`)

    if (!handlerPath) {
      return
    }

    const { documentation: funcDoc, schema } = await import(handlerPath)

    if (!funcDoc) {
      return
    }

    if (schema) {
      addParams(schema, funcDoc, 'pathParams')
      addParams(schema, funcDoc, 'queryParams')
      addParams(schema, funcDoc, 'cookieParams')
      addParams(schema, funcDoc, 'requestHeaders')

      if (schema.body) {
        const name = `${func.name.charAt(0).toUpperCase()}${func.name.slice(1)}Request`
        documentation.custom.models.push(createModel(toJSONSchema(schema.body), name))
        if (!funcDoc.requestModels) {
          funcDoc.requestModels = {
            'application/json': name,
          }
        }
      }

      const resSuccess = funcDoc?.methodResponses?.filter(res => String(res.statusCode).startsWith('2'))

      if (schema.response) {
        const name = `${func.name.charAt(0).toUpperCase()}${func.name.slice(1)}Response`
        documentation.custom.models.push(createModel(toJSONSchema(schema.response), name))
        resSuccess?.forEach((res) => {
          if (!res.responseModels) {
            res.responseModels = {
              'application/json': name,
            }
          }
        })
      }

      if (schema.responseHeaders) {
        resSuccess?.forEach((res) => {
          if (!res.responseHeaders) {
            addParams(schema, res, 'responseHeaders')
          }
        })
      }
    }

    func.events[0].http.documentation = funcDoc
  }

  const examples400 = []
  const examples401 = []
  const examples403 = []
  const examples404 = []
  const examples429 = []
  const examples500 = []

  const mergedErrors = {
    ...ERRORS,
    ...APPLICATION_ERRORS,
  }
  Object.keys(mergedErrors).forEach((mainKey) => {
    Object.keys(mergedErrors[mainKey]).forEach((error) => {
      const thisError = mergedErrors[mainKey][error]
      if (!thisError.statusCode) {
        return
      }

      const example = {
        title: `${thisError.code} - ${thisError.message}`,
        value: {
          code: thisError.code,
          message: thisError.message,
          statusCode: thisError.statusCode,
        },
      }

      // Exceptional case
      if (thisError.code === 'PA005') {
        example.value.info = {
          errors: [
            {
              message: '"Last Onboarded" must be a boolean',
              path: [
                'lastOnboarded',
              ],
              type: 'boolean.base',
              context: {
                label: 'Last Onboarded',
                value: 2,
                key: 'lastOnboarded',
              },
              paramType: 'body',
            },
          ],
        }
      }

      switch (thisError.statusCode) {
        case 400:
          examples400.push(example)
          break
        case 401:
          examples401.push(example)
          break
        case 403:
          examples403.push(example)
          break
        case 404:
          examples404.push(example)
          break
        case 429:
          examples429.push(example)
          break
        case 500:
          examples500.push(example)
          break
        default: break
      }
    })
  })

  // Put the error schemas at the end, just like the other ASA API documents
  Object.keys(globalSchemas).forEach((name) => {
    // ErrorLocalSchema is only used locally and does not need to be in the documentation
    if (name !== 'ErrorLocalSchema') {
      const initialSchema = globalSchemas[name]
      const jsonSchema = toJSONSchema(initialSchema)
      if (!Array.isArray(jsonSchema.examples)) {
        jsonSchema.examples = []
      }

      switch (jsonSchema.properties.statusCode.example) {
        case 400:
          examples400.forEach(example => jsonSchema.examples.push(example))
          break
        case 401:
          examples401.forEach(example => jsonSchema.examples.push(example))
          break
        case 403:
          examples403.forEach(example => jsonSchema.examples.push(example))
          break
        case 404:
          examples404.forEach(example => jsonSchema.examples.push(example))
          break
        case 429:
          examples429.forEach(example => jsonSchema.examples.push(example))
          break
        case 500:
          examples500.forEach(example => jsonSchema.examples.push(example))
          break
        default: break
      }
      if (jsonSchema.examples.length > 0) {
        jsonSchema.examples.sort((a, b) => {
          if (a.title < b.title) {
            return -1
          }

          if (a.title > b.title) {
            return 1
          }

          return 0
        })
      } else {
        delete jsonSchema.examples
      }
      documentation.custom.models.push(createModel(jsonSchema, name))
    }
  })

  // console.log(documentation.custom);
  const generator = new DefinitionGenerator(documentation.custom)

  generator.parse()
  // console.log(documentation.functions[0].events[0].http.documentation)
  // Add Paths to OpenAPI Output from Function Configuration
  generator.readFunctions(documentation.functions)

  let { definition } = generator

  definition = convertTypeArrayToOneOf(definition)

  await SwaggerParser.validate(JSON.parse(JSON.stringify(definition)))

  // If for any endpoint there is a 204 response, then we want to delete the content object if it is empty
  Object.keys(definition.paths).forEach((path) => {
    Object.keys(definition.paths[path]).forEach((method) => {
      const response = definition.paths[path][method].responses
      if (response['204'] && response['204'].content && Object.keys(response['204'].content).length === 0) {
        delete response['204'].content
      }
    })
  })

  return definition
}

function convertTypeArrayToOneOf(schema) {
  if (Array.isArray(schema.type)) {
    schema.oneOf = schema.type.map(type => ({ type }))

    delete schema.type
  }
  Object.keys(schema).forEach((key) => {
    if (schema[key] && typeof schema[key] === 'object') {
      convertTypeArrayToOneOf(schema[key])
    }
  })

  return schema
}

function log(...args) {
  process.stdout.write(args.join(' '))
}

export default class ServerlessDocumentation {
  constructor(serverless) {
    this.serverless = serverless

    // Declare the commands this plugin exposes for the Serverless CLI
    this.commands = {
      openapi: {
        commands: {
          generate: {
            lifecycleEvents: ['serverless'],
            usage: 'Generate OpenAPI v3 Documentation',
            options: {
              output: {
                usage: 'Output file location [default: openapi.yml|json]',
                shortcut: 'o',
                type: 'string',
              },
              format: {
                usage: 'OpenAPI file format (yml|json) [default: yml]',
                shortcut: 'f',
                type: 'string',
              },
              indent: {
                usage: 'File indentation in spaces [default: 2]',
                shortcut: 'i',
                type: 'string',
              },
            },
          },
        },
      },
    }

    // Declare the hooks our plugin is interested in
    this.hooks = {
      'openapi:generate:serverless': this.generate.bind(this),
    }

    this.serverless.configSchemaHandler.defineFunctionEventProperties('aws', 'httpApi', {
      properties: {
        documentation: {
          oneOf: [
            { type: 'object' },
            { type: 'boolean' },
          ],
        },
      },
    })

    this.serverless.configSchemaHandler.defineFunctionEventProperties('aws', 'http', {
      properties: {
        documentation: {
          oneOf: [
            { type: 'object' },
            { type: 'boolean' },
          ],
        },
      },
    })
  }

  /**
   * Processes CLI input by reading the input from serverless
   */
  processCliInput() {
    const config = {
      file: this.serverless.processedInput.options.output || 'openapi.yml',
      indent: this.serverless.processedInput.options.indent || 2,
    }

    config.format = this.serverless.processedInput.options.format
    if (!config.format) {
      config.format = config.file.endsWith('.yml') ? 'yaml' : 'json'
    }

    log(
      '[OPTIONS]',
      `format: "${config.format}",`,
      `output file: "${config.file}",`,
      `indentation: "${String(config.indent)}"\n\n`,
    )

    return config
  }

  async generate() {
    log('OpenAPI v3 Documentation Generator\n\n')
    const definition = await buildDocumentation(this.serverless)

    // Process CLI Input options
    const config = this.processCliInput()

    let output
    if (config.format === 'json') {
      output = JSON.stringify(definition, null, config.indent)
    } else {
      output = json2yml.stringify(definition)
    }

    // Output the OpenAPI document to the correct format
    await fs.mkdir(dirname(config.file)).catch(() => {})
    await fs.writeFile(config.file, output)
    log(`[OUTPUT] To "${config.file}"\n`)
  }
}
