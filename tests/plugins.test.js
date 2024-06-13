/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'

import decompress from 'decompress'
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
  const res = await exec`npm ci`
  console.log(`> ${res.stdout}`)
})

const checkFile = async (filePath) => {
  const content = await fs.readFile(path.resolve('./example', filePath), 'utf-8')
  expect(content).toMatchFileSnapshot(path.resolve('./tests/__snapshots__', filePath)).catch(() => {
    throw new Error('not equal')
  })
}

describe('serverless bundle', () => {
  it('build the handlers', async () => {
    console.log('> Bundle project')
    const res = await exec`npm run bundle`
    console.log(`> ${res.stdout}`)

    await checkFile('dist/hello1/src/handlers/hello1.js')
    await checkFile('dist/hello1/static/global.txt')
    await checkFile('dist/hello1/static/individual.txt')
    await checkFile('dist/hello2/src/handlers/hello2.js')
    await checkFile('dist/hello2/static/global.txt')
    await checkFile('dist/hello2/asset/individual.txt')
    await checkFile('dist/hello3/src/handlers/hello3.js')
    await checkFile('dist/hello3/static/global.txt')
    await expect(fs.stat('./example/dist/hello2/static/individual.txt')).rejects.toThrowError(/ENOENT/)
    await expect(fs.stat('./example/dist/hello3/static/individual.txt')).rejects.toThrowError(/ENOENT/)

    await decompress('example/.serverless/hello1.zip', 'example/.serverless/hello1')
    await decompress('example/.serverless/hello2.zip', 'example/.serverless/hello2')
    await decompress('example/.serverless/hello3.zip', 'example/.serverless/hello3')

    await checkFile('.serverless/hello1/src/handlers/hello1.js')
    await checkFile('.serverless/hello1/static/global.txt')
    await checkFile('.serverless/hello1/static/individual.txt')
    await checkFile('.serverless/hello2/src/handlers/hello2.js')
    await checkFile('.serverless/hello2/static/global.txt')
    await checkFile('.serverless/hello2/asset/individual.txt')
    await checkFile('.serverless/hello3/src/handlers/hello3.js')
    await checkFile('.serverless/hello3/static/global.txt')
    await expect(fs.stat('./example/.serverless/hello2/static/individual.txt')).rejects.toThrowError(/ENOENT/)
    await expect(fs.stat('./example/.serverless/hello3/static/individual.txt')).rejects.toThrowError(/ENOENT/)
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

describe('serverless offline-sqs', () => {
  it('should start the sqs with the offline action', async () => {
    console.log('> Running offline')

    const proc = exec`npm run offline`

    let done = false
    for await (const chunk of proc.stdout) {
      const line = chunk.toString()
      console.log(line)
      if (line.includes('offline-sqs')) {
        const url = line.replace('\n', '').replace('> offline-sqs:', '').slice(1)
        const endpoint = `${url}/statistics/queues`
        const queues = await fetch(endpoint).then(res => res.json())
        expect(queues).toContainEqual({
          name: 'test_queue.fifo',
          statistics: expect.any(Object),
        })
        expect(queues).toContainEqual({
          name: 'dlq_test_queue.fifo',
          statistics: expect.any(Object),
        })
        done = true
        break
      }
    }

    expect(done).toBeTruthy()
  })
})
