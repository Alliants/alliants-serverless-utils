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
      }, {
        host: 9325,
        container: 9325,
      })
      .withName('test-sqs')
      .withReuse()
      .start()

    const client = new SQSClient({
      region,
      endpoint: `http://localhost:${port}`,
      credentials: {
        accessKeyId: 'root',
        secretAccessKey: 'root',
      },
    })

    await client.send(new CreateQueueCommand({
      QueueName: `${this.serverless.service.custom['email-queue'].dlqQueueName}.fifo`,
      Attributes: {
        FifoQueue: 'true',
        ContentBasedDeduplication: 'true',
      },
    }))

    await super.start()
  }

  async end() {
    if (this.elasticContainer) {
      await this.elasticContainer.stop()
    }
    await super.end()
  }
}
