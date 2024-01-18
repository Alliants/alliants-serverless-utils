import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import archiver from 'archiver'
import { deleteAsync } from 'del'
import * as esbuild from 'esbuild'
import copy from 'esbuild-plugin-copy-watch'
import { fdir as FDir } from 'fdir'

/** @typedef {import('serverless')} Serverless */

function patternToDir(pattern) {
  const segments = pattern.split('/')
  const result = []
  for (const segment of segments) {
    if (segment.includes('*') || segment.includes('.')) {
      break
    }

    result.push(segment)
  }

  return result.join('/')
}

async function nodeZip(funcName) {
  const fromDir = `dist/${funcName}`
  const zipPath = `.serverless/${funcName}.zip`
  const filesPathList = await new FDir().withRelativePaths().crawl(fromDir).withPromise()
  const zipArchive = archiver.create('zip')
  const output = fs.createWriteStream(zipPath)

  // write zip
  output.on('open', () => {
    zipArchive.pipe(output)

    filesPathList.forEach((relativePath) => {
      const fullPath = path.resolve(path.join(process.cwd(), fromDir, relativePath))
      const stats = fs.statSync(fullPath)
      if (stats.isDirectory()) return

      zipArchive.append(fs.readFileSync(fullPath), {
        name: relativePath,
        mode: stats.mode,
        date: new Date(0), // necessary to get the same hash when zipping the same content
      })
    })

    zipArchive.append(JSON.stringify({
      name: funcName,
      type: 'module',
    }, null, 2), {
      name: './package.json',
      date: new Date(0),
    })

    zipArchive.finalize()
  })

  return new Promise((resolve, reject) => {
    output.on('close', resolve)
    zipArchive.on('error', err => reject(err))
  })
}

export default class ServerlessBundle {
  /**
   * @param {Serverless} serverless
   */
  constructor(serverless) {
    this.serverless = serverless

    /** @type {Map<string, { name: string, ctx: import('esbuild').BuildContext, handler: string }>} */
    this.contexts = new Map()

    // Declare the hooks our plugin is interested in
    this.hooks = {
      'before:package:createDeploymentArtifacts': async () => {
        await this.init()
        await this.build()
        await this.pack()
      },
      'after:package:createDeploymentArtifacts': async () => {
        await this.dispose()
      },
      'before:offline:start': async () => {
        await this.init()
        await this.build()
        await this.watch()
      },
      'before:offline:start:init': async () => {
        await this.init()
        await this.build()
        await this.watch()
      },
      'before:invoke:local:invoke': async () => {
        await this.init()
        await this.build()
      },
      'after:invoke:local:invoke': async () => {
        await this.dispose()
      },
    }
  }

  async init() {
    const outputDir = 'dist'

    await deleteAsync(outputDir)

    const mod = await import(`${process.cwd()}/bundle.config.js`).catch(() => {})
    let userSettings = {}
    if (mod?.default) {
      userSettings = await mod.default(this.serverless)
    }

    const { functions, package: pkg } = this.serverless.service

    const baseCopyPaths = pkg?.patterns?.map(pattern => ({
      from: pattern,
      to: patternToDir(pattern),
    })) || []

    await Promise.all(Object.keys(functions).map(async (name) => {
      const func = functions[name]

      const outdir = `${outputDir}/${name}`

      const [functionPath, handlerName] = func.handler.split('.')

      const copyPaths = [
        ...baseCopyPaths,
        ...(func?.package?.patterns?.map(pattern => ({
          from: pattern,
          to: patternToDir(pattern),
        })) || []),
        ...(userSettings?.copy || []),
      ]

      const {
        sourcemap = 'inline',
        external = [],
        inject = [],
        plugins = [],
        banner = {
          js: '',
        },
      } = userSettings

      const ctx = await esbuild.context({
        ...userSettings,
        entryPoints: [`${functionPath}.js`],
        bundle: true,
        platform: 'node',
        target: 'node20',
        format: 'esm',
        outbase: './',
        treeShaking: true,
        outdir,
        keepNames: true,
        sourcemap,
        minify: this.serverless.configurationInput.provider.stage !== 'local',
        external: [
          'aws-sdk',
          'better-sqlite3',
          'tedious',
          'mysql',
          'mysql2',
          'oracledb',
          'pg-query-stream',
          'sqlite3',
          ...external,
        ],
        inject: [
          sourcemap && 'source-map-support/register.js',
          ...inject,
        ].filter(Boolean),
        banner: {
          js: `import { createRequire as topLevelCreateRequire } from 'module';\n const require = topLevelCreateRequire(import.meta.url);\n${banner.js}`,
        },
        plugins: [
          copyPaths.length && copy({
            paths: copyPaths,
          }),
          ...plugins,
        ].filter(Boolean),
      })

      this.contexts.set(name, {
        name,
        ctx,
        // we need to keep the old handler path
        handler: func.handler,
      })

      func.handler = `${outdir}/${functionPath}.${handlerName}`
    }))
  }

  async build() {
    await Promise.all(Array.from(this.contexts.values()).map(({ ctx }) => ctx.rebuild()))
  }

  async watch() {
    const { functions } = this.serverless.service
    await Promise.all(
      Array.from(this.contexts.values())
        .filter(({ name }) => {
          return !!(functions[name].events.find(e => !!(e.http)))
        })
        .map(({ ctx }) => ctx.watch()),
    )
  }

  async dispose() {
    await Promise.all(Array.from(this.contexts.values()).map(({ ctx }) => ctx.dispose()))
  }

  async pack() {
    await Promise.all(
      Array.from(this.contexts.values())
        .map(async ({ name, handler }) => {
          await nodeZip(name)
          const func = this.serverless.service.functions[name]
          const artifact = `.serverless/${name}.zip`
          func.handler = handler
          if (func.package) {
            func.package.artifact = artifact
          } else {
            func.package = {
              artifact,
            }
          }
        }),
    )
  }
}
