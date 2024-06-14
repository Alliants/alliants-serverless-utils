import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import archiver from 'archiver'
import chokidar from 'chokidar'
import cpy from 'cpy'
import { deleteAsync } from 'del'
import * as esbuild from 'esbuild'
import pAll from 'p-all'
import debounce from 'p-debounce'
import picomatch from 'picomatch'
/** @typedef {import('serverless')} Serverless */

const OUTDIR = 'dist'

const SLS_BIN = fileURLToPath(import.meta.resolve('serverless/bin/serverless.js'))

async function nodeZip(funcName, baseFilename) {
  const zipPath = `.serverless/${funcName}.zip`
  const zipArchive = archiver.create('zip')
  const output = fs.createWriteStream(zipPath)

  // write zip
  output.on('open', async () => {
    zipArchive.pipe(output)

    const watcher = chokidar.watch('.', {
      alwaysStat: true,
      cwd: path.resolve(process.cwd(), 'dist', baseFilename),
    })
    watcher.on('add', (filePath, stats) => {
      const fullPath = path.resolve(process.cwd(), 'dist', baseFilename, filePath)
      zipArchive.append(fs.readFileSync(fullPath), {
        name: filePath,
        mode: stats.mode,
        date: new Date(0), // necessary to get the same hash when zipping the same content
      })
    })
    await once(watcher, 'ready')
    await watcher.close()

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

    /** @type {Map<string, { handler: string, name: string, filename: string, patterns: string[] }>} */
    this.functions = new Map()

    /** @type {import('esbuild').BuildContext} */
    this.ctx = null

    /** @type {import('chokidar').FSWatcher>} */
    this.watcher = null

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

    /** @type {string[]} */
    this.entryPoints = null

    /** @type {boolean} */
    this.bundleOfflineDisabled = ['1', 'true'].includes(process.env.DISABLE_BUNDLE_OFFLINE)

    /** @type {import('esbuild').BuildOptions} */
    this.bundleOptions = null

    /** @type {{ watchDebounce?: number, concurrency?: number }} */
    this.extraBundleOptions = null

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
        await this.init()
        this.initDevMode()
        await this.build()
      },
      'before:package:createDeploymentArtifacts': async () => {
        this.renameFunctions()
        await this.init()
        await this.build({ splitting: false })
        await this.pack()
      },
      'after:package:createDeploymentArtifacts': async () => {
        await this.dispose()
      },
      'before:deploy:function:packageFunction': async () => {
        this.renameFunctions()
        await this.init()
        await this.build({ splitting: false })
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

  async init() {
    if (this.initializing) return this.initializing

    const _init = async () => {
      await deleteAsync(OUTDIR)

      const mod = await import(`${process.cwd()}/bundle.config.js`).catch(() => {})
      let userSettings = {}
      if (mod?.default) {
        userSettings = await mod.default(this.serverless)
      }

      const {
        sourcemap = 'inline',
        external = [],
        inject = [],
        plugins = [],
        banner = {
          js: '',
        },
        watchDebounce = 1500,
        concurrency = ('SERVERLESS_BUNDLE_CONCURRENCY' in process.env ? Number(process.env.SERVERLESS_BUNDLE_CONCURRENCY) : 8),
      } = userSettings

      delete userSettings.watchDebounce
      delete userSettings.concurrency

      this.extraBundleOptions = {
        watchDebounce,
        concurrency,
      }

      this.bundleOptions = {
        ...userSettings,
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
          js: [
            'import { createRequire as topLevelCreateRequire } from \'node:module\';',
            'import { fileURLToPath as rootFileURLToPath, URL as RootURL } from \'node:url\';',
            'const require = topLevelCreateRequire(import.meta.url);',
            'const __filename = rootFileURLToPath(import.meta.url);',
            'const __dirname = rootFileURLToPath(new RootURL(\'.\', import.meta.url));',
            banner?.js,
          ].filter(Boolean).join('\n'),
        },
        plugins: plugins.filter(Boolean),
      }
    }

    this.initializing = _init()
    return this.initializing
  }

  initDevMode() {
    this.devMode = true

    this._spawn = debounce(async () => {
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
    }, this.extraBundleOptions.watchDebounce)

    this.bundleOptions.plugins = [...this.bundleOptions.plugins.filter(Boolean), {
      name: 'devMode',
      setup: (build) => {
        build.onEnd(() => {
          return this._spawn()
        })
      },
    }]
  }

  async build({ splitting = true } = {}) {
    if (this.building) return this.building

    const _build = async () => {
      await this._addCopyWatcher()
      if (this.devMode) {
        this.ctx = await esbuild.context({
          ...this.bundleOptions,
          entryPoints: this.entryPoints,
          splitting,
        })
        await this?.ctx?.watch()
      } else {
        await pAll(
          this.entryPoints.map((entryPoint) => {
            return () => esbuild.build({
              ...this.bundleOptions,
              entryPoints: [entryPoint],
              splitting,
            })
          }),
          { concurrency: this.extraBundleOptions.concurrency },
        )
      }
    }

    this.building = _build()
    return this.building
  }

  async dispose() {
    if (this.disposing) return this.disposing

    const _dispose = async () => {
      if (this.initializing) {
        await this.initializing
      }

      await this?.ctx?.dispose()
      await this?.watcher?.close()
    }

    this.disposing = _dispose()
    return this.disposing
  }

  async pack() {
    if (this.packing) return this.packing

    if (!fs.existsSync('.serverless')) {
      fs.mkdirSync('.serverless')
    }

    this.packing = pAll(Array.from(this.functions.values()).map(({ name, filename, handler }) => {
      return async () => {
        await new Promise(resolve => setTimeout(resolve, 5000))
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
      }
    }), { concurrency: this.extraBundleOptions.concurrency })

    return this.packing
  }

  async _addCopyWatcher() {
    const { package: pkg } = this.serverless.service

    const globs = []
    const globalPatterns = []
    const patternsByHandler = []

    pkg?.patterns?.forEach((pattern) => {
      const [glob, dest = ''] = pattern.split(':')
      globs.push(glob)
      globalPatterns.push({ isMatch: picomatch(glob), dest })
    })

    this.functions.forEach((func) => {
      func?.patterns?.forEach((pattern) => {
        const [glob, dest = ''] = pattern.split(':')
        globs.push(glob)
        patternsByHandler.push({ isMatch: picomatch(glob), filename: func.filename, dest })
      })
    })

    this.watcher = chokidar.watch(globs, {
      persistent: true,
    })

    let initCopy = true
    const initialCopyFiles = []

    const onFile = (filePath) => {
      globalPatterns.forEach(({ isMatch, dest }) => {
        if (!isMatch(filePath)) return

        dest = dest || path.dirname(filePath)

        if (initCopy) {
          this.functions.forEach((func) => {
            initialCopyFiles.push({ filePath, destPath: path.resolve(OUTDIR, func.filename, dest) })
          })
          return
        }

        this.functions.forEach((func) => {
          const destPath = path.resolve(OUTDIR, func.filename, dest)
          const promise = cpy(filePath, destPath)
            .catch((err) => {
              log(`ServerlessBundle copy error ['${destPath}']: ${err.message}`)
            }).finally(() => {
              this.cpyJobs.delete(promise)
            })
          this.cpyJobs.add(promise)
        })
      })

      patternsByHandler.forEach(({ isMatch, filename, dest }) => {
        if (!isMatch(filePath)) return

        const destPath = path.resolve(OUTDIR, filename, dest || path.dirname(filePath))

        if (initCopy) {
          initialCopyFiles.push({ filePath, destPath })
          return
        }

        const promise = cpy(filePath, destPath)
          .catch((err) => {
            log(`ServerlessBundle copy error ['${destPath}']: ${err.message}`)
          }).finally(() => {
            this.cpyJobs.delete(promise)
          })
        this.cpyJobs.add(promise)
      })

      const jobs = Array.from(this.cpyJobs.values())
      if (jobs.length > 0 && this.devMode) {
        Promise.all(jobs).then(() => this._spawn())
      }
    }

    this.watcher.on('add', onFile)
    this.watcher.on('change', onFile)
    await once(this.watcher, 'ready')
    initCopy = false

    await pAll(initialCopyFiles.map((file) => {
      return () => {
        const promise = cpy(file.filePath, file.destPath)
          .catch((err) => {
            log(`ServerlessBundle copy error ['${file.destPath}']: ${err.message}`)
          }).finally(() => {
            this.cpyJobs.delete(promise)
          })
        this.cpyJobs.add(promise)
        return promise
      }
    }), { concurrency: this.extraBundleOptions.concurrency })
  }
}
