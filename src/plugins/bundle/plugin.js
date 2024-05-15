import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import archiver from 'archiver'
import chokidar from 'chokidar'
import cpy from 'cpy'
import { deleteAsync } from 'del'
import * as esbuild from 'esbuild'
import { fdir as FDir } from 'fdir'

/** @typedef {import('serverless')} Serverless */

async function nodeZip(funcName, filename) {
  const fromDir = `dist/${filename}`
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

function log(...args) {
  process.stdout.write(args.join(' '))
}

function unique(arr) {
  return Array.from(new Set(arr).values())
}

const OUTDIR = 'dist'
export default class ServerlessBundle {
  /**
   * @param {Serverless} serverless
   */
  constructor(serverless) {
    this.serverless = serverless

    /** @type {Map<string, { handler: string, name: string, filename: string }>} */
    this.functions = new Map()

    /** @type {import('esbuild').BuildContext} */
    this.ctx = null

    /** @type {import('chokidar').FSWatcher>} */
    this.watcher = null
    /** @type {Map<string, import('chokidar').FSWatcher>} */
    this.functionWatchers = new Set()
    /** @type {Set<Promise>} */
    this.cpyJobs = new Set()

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
      'before:deploy:function:packageFunction': async () => {
        await this.init()
        await this.build()
        await this.pack()
      },
      'after:deploy:function:packageFunction': async () => {
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
    await deleteAsync(OUTDIR)

    const mod = await import(`${process.cwd()}/bundle.config.js`).catch(() => {})
    let userSettings = {}
    if (mod?.default) {
      userSettings = await mod.default(this.serverless)
    }

    const { functions, package: pkg } = this.serverless.service

    const {
      sourcemap = 'inline',
      external = [],
      inject = [],
      plugins = [],
      banner = {
        js: '',
      },
    } = userSettings

    const entryPoints = unique(
      Object.keys(functions).map((name) => {
        const func = functions[name]
        const [functionPath] = func.handler.split('.')
        const filename = path.basename(functionPath)
        this.functions.set(name, {
          handler: func.handler,
          name,
          filename,
        })
        func.handler = `${OUTDIR}/${filename}/${func.handler}`
        this._addCopyWatcher(func?.package?.patterns, `${OUTDIR}/${filename}`)
        return `${functionPath}.js`
      }),
    )

    this._addCopyWatcher(pkg?.patterns)

    this.ctx = await esbuild.context({
      ...userSettings,
      entryPoints,
      entryNames: '[name]/[dir]/[name]',
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      outbase: './',
      treeShaking: true,
      outdir: OUTDIR,
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
        js: `import { createRequire as topLevelCreateRequire } from 'module';\n const require = topLevelCreateRequire(import.meta.url);\n${banner?.js}`,
      },
      plugins: plugins.filter(Boolean),
    })
  }

  async build() {
    await Promise.all(Array.from(this.cpyJobs.values()))
    await this.ctx.rebuild()
  }

  async watch() {
    await this.ctx.watch()
  }

  async dispose() {
    await this.ctx.dispose()
    await this?.watcher?.close()
    await Promise.all(Array.from(this.functionWatchers.values()).map(watcher => watcher.close()))
  }

  async pack() {
    await Promise.all(
      Array.from(this.functions.values())
        .map(async ({ name, filename, handler }) => {
          await nodeZip(name, filename)
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

  _addCopyWatcher(patterns, outdir) {
    if (!patterns || patterns.length === 0) return

    const watcher = chokidar.watch(patterns, {
      persistent: true,
    })

    if (!outdir) {
      this.watcher = watcher
      const filenames = unique(Array.from(this.functions.values()).map(f => f.filename))

      const onFile = (pathname) => {
        filenames.forEach((name) => {
          const promise = cpy(pathname, `${OUTDIR}/${name}`)
            .catch((err) => {
              log(`ServerlessBundle copy error ['${pathname}']: ${err.message}`)
            }).finally(() => {
              this.cpyJobs.delete(promise)
            })
          this.cpyJobs.add(promise)
        })
      }
      watcher.on('add', onFile)
      watcher.on('change', onFile)
      return
    }

    const onFile = (pathname) => {
      const promise = cpy(pathname, outdir)
        .catch((err) => {
          log(`ServerlessBundle copy error ['${pathname}']: ${err.message}`)
        }).finally(() => {
          this.cpyJobs.delete(promise)
        })
      this.cpyJobs.add(promise)
    }
    watcher.on('add', onFile)
    watcher.on('change', onFile)
    this.functionWatchers.add(watcher)
  }
}
