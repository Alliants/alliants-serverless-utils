/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'

import { deleteAsync } from 'del'
import { $ } from 'execa'
import { beforeAll, describe, expect, it } from 'vitest'

const exec = $({ cwd: path.resolve(process.cwd(), 'example') })

beforeAll(async () => {
  await deleteAsync([
    'example/dist',
    'example/bruno',
    'example/docs',
  ])
  console.log('> Installing dependencies')
  const res = await exec`npm install`
  console.log(`> ${res.stdout}`)
})

const checkFile = async (filePath, binary = false) => {
  const content = await fs.readFile(path.resolve('./example', filePath), binary ? 'binary' : 'utf-8')
  expect(content).toMatchFileSnapshot(path.resolve('./tests/__snapshots__', filePath))
}

describe('serverless bundle', () => {
  it('build the handlers', async () => {
    console.log('> Bundle project')
    const res = await exec`npm run bundle`
    console.log(`> ${res.stdout}`)

    await checkFile('dist/hello1/src/handlers/hello1.js')
    await checkFile('dist/hello1/static/global.txt')
    await checkFile('dist/hello1/static/individual.txt')
    await checkFile('.serverless/hello1.zip', true)

    await checkFile('dist/hello2/src/handlers/hello2.js')
    await checkFile('dist/hello2/static/global.txt')
    await expect(fs.stat('./example/hello2/static/individual.txt')).rejects.toThrowError(/ENOENT/)
    await checkFile('.serverless/hello2.zip', true)
  })
})

describe('serverless documentation', () => {
  it('generate the openapi documentation', async () => {
    console.log('> Generate documentation')
    const res = await exec`npm run documentation`
    console.log(`> ${res.stdout}`)

    await checkFile('docs/openapi.json')
  })
})

describe('serverless bruno', () => {
  it('generate the bruno spec', async () => {
    console.log('> Generate bruno spec')
    const res = await exec`npm run bruno`
    console.log(`> ${res.stdout}`)

    await checkFile('bruno/bruno.json')
    await checkFile('bruno/Hello One Section/Hello 1.bru')
    await checkFile('bruno/Hello Two Section/Hello 2.bru')
  })
})
