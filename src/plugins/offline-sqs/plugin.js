/** @typedef {import('serverless')} Serverless */

import process from 'node:process'

import { CreateQueueCommand, SQSClient } from '@aws-sdk/client-sqs'
import ServerlessSQSOffline from 'serverless-offline-sqs'
import { GenericContainer } from 'testcontainers'

export default class OfflineSQS extends ServerlessSQSOffline {
  constructor(...args) {
    super(...args)

    if ('serverless-offline-sqs' in this.serverless.service.custom) {
      // disable the autoCreate
      this.serverless.service.custom['serverless-offline-sqs'].autoCreate = false
    }
  }

  async start() {
    const { endpoint, region } = this.serverless.service.custom['serverless-offline-sqs']
    const port = endpoint.split(':').pop()

    if (!(process.env.DISABLE_TEST_CONTAINER === '1' || process.env.DISABLE_TEST_CONTAINER === 'true')) {
      this.elasticContainer = await new GenericContainer('softwaremill/elasticmq-native')
        .withExposedPorts({
          host: port,
          container: 9324,
        }, 9325)
        .withName(`${this.serverless.service.service}-sqs`)
        .withReuse()
        .start()
    }

    const client = new SQSClient({
      region,
      endpoint: `http://localhost:${port}`,
      credentials: {
        accessKeyId: 'root',
        secretAccessKey: 'root',
      },
    })

    const queues = this.serverless.service.custom.queues
    for (const queueName of Object.keys(queues)) {
      if (queues[queueName].queueName) {
        await client.send(new CreateQueueCommand({
          QueueName: `${queues[queueName].queueName}.fifo`,
          Attributes: {
            FifoQueue: 'true',
            ContentBasedDeduplication: 'true',
          },
        }))
      }

      if (queues[queueName].dlqQueueName) {
        await client.send(new CreateQueueCommand({
          QueueName: `${queues[queueName].dlqQueueName}.fifo`,
          Attributes: {
            FifoQueue: 'true',
            ContentBasedDeduplication: 'true',
          },
        }))
      }
    }

    await super.start()

    // eslint-disable-next-line no-console
    console.log(`> offline-sqs: http://localhost:${this?.elasticContainer?.getMappedPort(9325) || 9325}`)
  }

  async end() {
    await this?.elasticContainer?.stop()
    await super.end()
  }
}
