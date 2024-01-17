import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { buildDocumentation } from '../documentation/plugin.js'
import { envJsonToBru, jsonToBru } from './bru.js'
import importCollection from './openapi-collection.js'
import { createDirectory, sanitizeDirectoryName } from './utils.js'

function log(...args) {
  process.stdout.write(args.join(' '))
}

export default class ServerlessBruno {
  constructor(serverless) {
    this.serverless = serverless

    // Declare the commands this plugin exposes for the Serverless CLI
    this.commands = {
      bruno: {
        commands: {
          generate: {
            lifecycleEvents: ['serverless'],
            usage: 'Generate Bruno Spec',
          },
        },
      },
    }

    // Declare the hooks our plugin is interested in
    this.hooks = {
      'bruno:generate:serverless': this.generate.bind(this),
    }
  }

  async generate() {
    log('Bruno Generator\n\n')
    const definition = await buildDocumentation(this.serverless)

    const collection = await importCollection(definition)

    const collectionName = sanitizeDirectoryName(collection.name)
    const collectionPath = path.resolve(process.cwd(), './bruno')

    // Recursive function to parse the collection items and create files/folders
    function parseCollectionItems(items = [], currentPath) {
      items.forEach((item) => {
        if (['http-request', 'graphql-request'].includes(item.type)) {
          const content = jsonToBru(item)
          const filePath = path.join(currentPath, `${item.name}.bru`)
          fs.writeFileSync(filePath, content)
        }

        if (item.type === 'folder') {
          const folderPath = path.join(currentPath, item.name)
          createDirectory(folderPath)

          if (item.items && item.items.length) {
            parseCollectionItems(item.items, folderPath)
          }
        }
      })
    }

    function parseEnvironments(environments = [], collectionPath) {
      const envDirPath = path.join(collectionPath, 'environments')
      if (!fs.existsSync(envDirPath)) {
        fs.mkdirSync(envDirPath)
      }

      environments.forEach((env) => {
        const content = envJsonToBru(env)
        const filePath = path.join(envDirPath, `${env.name}.bru`)
        fs.writeFileSync(filePath, content)
      })
    }

    createDirectory(collectionPath)

    const brunoConfig = {
      version: '1',
      name: collectionName,
      type: 'collection',
    }
    const content = JSON.stringify(brunoConfig, null, 2)

    fs.writeFileSync(path.join(collectionPath, 'bruno.json'), content)

    // create folder and files based on collection
    parseCollectionItems(collection.items, collectionPath)
    parseEnvironments(collection.environments, collectionPath)
    log(`[OUTPUT] To "${path.join(collectionPath, 'bruno.json')}"\n`)
  }
}
