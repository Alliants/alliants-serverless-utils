import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import archiver from 'archiver'
import chokidar from 'chokidar'
import cpy from 'cpy'
import { deleteAsync } from 'del'
import * as esbuild from 'esbuild'
import { fdir as FDir } from 'fdir'
import debounce from 'p-debounce'

/** @typedef {import('serverless')} Serverless */

const OUTDIR = 'dist'

const SLS_BIN = fileURLToPath(import.meta.resolve('serverless/bin/serverless.js'))

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
  // eslint-disable-next-line no-console
  console.log(...args)
}

function unique(arr) {
  return Array.from(new Set(arr).values())
}

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

    /** @type {Promise<void>} */
    this.initializing = null

    /** @type {Promise<void>} */
    this.building = null

    /** @type {Promise<void>} */
    this.packing = null

    /** @type {Promise<void>} */
    this.disposing = null

    /** @type {ReturnType<spawn>} */
    this.child = null

    /** @type {boolean} */
    this.devMode = false

    /** @type {Promise<void>} */
    this.initDevBuilding = false

    /** @type {string[]} */
    this.entryPoints = null

    /** @type {boolean} */
    this.bundleOfflineDisabled = ['1', 'true'].includes(process.env.DISABLE_BUNDLE_OFFLINE)

    this.commands = {
      bundle: {
        commands: {
          generate: {
            lifecycleEvents: ['serverless'],
            usage: 'Bundle the project',
          },
          dev: {
            lifecycleEvents: ['serverless'],
            usage: 'Dev offline mode with watch',
          },
        },
      },
    }

    // Declare the hooks our plugin is interested in
    this.hooks = {
      'bundle:generate:serverless': async () => {
        this.renameFunctions()
        log('> bundle:init')
        await this.init()
        log('> bundle:building')
        await this.build()
        await this.dispose()
        log('> bundle:done')
      },
      'bundle:dev:serverless': async () => {
        this.renameFunctions()
        this.devMode = true
        this.initDevBuilding = true
        await this.init()
        await this.build()
        this.initDevBuilding = false
        await this._spawn()
      },
      'before:package:createDeploymentArtifacts': async () => {
        this.renameFunctions()
        await this.init({ splitting: false })
        await this.build()
        await this.pack()
      },
      'after:package:createDeploymentArtifacts': async () => {
        await this.dispose()
      },
      'before:deploy:function:packageFunction': async () => {
        this.renameFunctions()
        await this.init({ splitting: false })
        await this.build()
        await this.pack()
      },
      'after:deploy:function:packageFunction': async () => {
        await this.dispose()
      },
      'before:offline:start': async () => {
        this.renameFunctions()
        if (this.bundleOfflineDisabled) return
        await this.init()
        await this.build()
        await this.dispose()
      },
      'before:offline:start:init': async () => {
        this.renameFunctions()
        if (this.bundleOfflineDisabled) return
        await this.init()
        await this.build()
        await this.dispose()
      },
      'before:invoke:local:invoke': async () => {
        this.renameFunctions()
        if (this.bundleOfflineDisabled) return
        await this.init()
        await this.build()
      },
      'after:invoke:local:invoke': async () => {
        if (this.bundleOfflineDisabled) return
        await this.dispose()
      },
    }
  }

  renameFunctions() {
    if (this.entryPoints) return

    const { functions } = this.serverless.service

    /** @type {string[]} */
    this.entryPoints = unique(
      Object.keys(functions).map((name) => {
        const func = functions[name]
        const [functionPath] = func.handler.split('.')
        const filename = path.basename(functionPath)
        this.functions.set(name, {
          handler: func.handler,
          name,
          filename,
          patterns: func?.package?.patterns,
        })
        func.handler = `${OUTDIR}/${filename}/${func.handler}`
        return `${functionPath}.js`
      }),
    )
  }

  /**
   * @param {{
   *  splitting: boolean
   * }} forceOptions
   */
  async init(forceOptions = {}) {
    if (this.initializing) return this.initializing

    const _init = async () => {
      await deleteAsync(OUTDIR)

      const mod = await import(`${process.cwd()}/bundle.config.js`).catch(() => {})
      let userSettings = {}
      if (mod?.default) {
        userSettings = await mod.default(this.serverless)
      }

      const { package: pkg } = this.serverless.service

      const {
        sourcemap = 'inline',
        external = [],
        inject = [],
        plugins = [],
        banner = {
          js: '',
        },
        watchDebounce = 1500,
      } = userSettings

      this._spawn = debounce(async () => {
        if (!this.devMode || this.initDevBuilding) return

        if (this.child && !(this.child.killed)) {
          log('> Offline Reload')
          this.child.kill('SIGHUP')
          await new Promise(resolve => this.child.once('exit', () => resolve()))
        }

        this.child = spawn('node', [SLS_BIN, 'offline', 'start', '--useInProcess'], {
          env: {
            ...process.env,
            DISABLE_BUNDLE_OFFLINE: 1,
          },
          stdio: [0, 1, 2],
        })
      }, watchDebounce)

      this.functions.forEach((func) => {
        this._addCopyWatcher(func.patterns, `${OUTDIR}/${func.filename}`)
      })

      this._addCopyWatcher(pkg?.patterns)

      this.ctx = await esbuild.context({
        ...userSettings,
        entryPoints: this.entryPoints,
        entryNames: '[name]/[dir]/[name]',
        bundle: true,
        splitting: 'splitting' in forceOptions ? forceOptions.splitting : true,
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
          js: [
            'import { createRequire as topLevelCreateRequire } from \'node:module\';',
            'import { fileURLToPath as rootFileURLToPath, URL as RootURL } from \'node:url\';',
            'const require = topLevelCreateRequire(import.meta.url);',
            'const __filename = rootFileURLToPath(import.meta.url);',
            'const __dirname = rootFileURLToPath(new RootURL(\'.\', import.meta.url));',
            banner?.js,
          ].filter(Boolean).join('\n'),
        },
        plugins: [...plugins.filter(Boolean), {
          name: 'devMode',
          setup: (build) => {
            if (!this.devMode) return
            build.onEnd(() => {
              return this._spawn()
            })
          },
        }],
      })
    }

    this.initializing = _init()
    return this.initializing
  }

  async build() {
    if (this.building) return this.building

    const _build = async () => {
      await Promise.all(Array.from(this.cpyJobs.values()))
      if (this.devMode) {
        await this?.ctx?.watch()
      } else {
        await this?.ctx?.rebuild()
      }
    }

    this.building = _build()
    return this.building
  }

  async watch() {
    await this?.ctx?.watch()
  }

  async dispose() {
    if (this.disposing) return this.disposing

    const _dispose = async () => {
      if (this.initializing) {
        await this.initializing
      }

      await this?.ctx?.dispose()
      await this?.watcher?.close()
      await Promise.all(Array.from(this.functionWatchers.values()).map(watcher => watcher.close()))
    }

    this.disposing = _dispose()
    return this.disposing
  }

  async pack() {
    if (this.packing) return this.packing

    if (!fs.existsSync('.serverless')) {
      fs.mkdirSync('.serverless')
    }

    this.packing = Promise.all(
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

    return this.packing
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
            .then(() => this._spawn())
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
        .then(() => this._spawn())
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
