/** @typedef {import('serverless')} Serverless */

import { CreateQueueCommand, SQSClient } from '@aws-sdk/client-sqs'
import ServerlessSQSOffline from 'serverless-offline-sqs'
import { GenericContainer } from 'testcontainers'

export default class OfflineSQS extends ServerlessSQSOffline {
  async start() {
    const { endpoint, region } = this.serverless.service.custom['serverless-offline-sqs']
    const port = endpoint.split(':').pop()
    this.elasticContainer = await new GenericContainer('softwaremill/elasticmq-native')
      .withExposedPorts({
        host: port,
        container: port,
      }, 9325)
      .withName(`${this.serverless.service.service}-sqs`)
      .withReuse()
      .start()

    // eslint-disable-next-line no-console
    console.log(`> offline-sqs: http://localhost:${this.elasticContainer.getMappedPort(9325)}`)

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
  }

  async end() {
    if (this.elasticContainer) {
      await this.elasticContainer.stop()
    }
    await super.end()
  }
}
