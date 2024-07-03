<span align="center">
<br>

![Alliants Logo](assets/alliants-logo.png)

# Serverless Utils

</span>

Set of tools for serverless framework applications.

## Install

```bash
$ npm install https://github.com/Alliants/alliants-serverless-utils
```

## Usage

### Eslint

Create an eslint.config.js with:

```js
import config from 'alliants-serverless-utils/eslint'

export default config(/** options */)
```

The `options` available can be found here: https://github.com/antfu/eslint-config

### Bundle Plugin

Plugin bundler to build in single files every handler of your serverless functions.

Add to your `serverless.yml`

```yml
plugins:
  - alliants-serverless-utils/plugins/bundle

package:
  individually: true
```

The plugin uses esbuild, if you want to configure it you can define a `bundle.config.js` in the root path with:

```javascript
export default (/** serverless */) => {
  return {
    sourcemap: false
  }
}
```

### Documentation Plugin

Plugin to generate an openapi documentation based on the serverless functions exported.

Add to your `serverless.yml`

```yml
plugins:
  - alliants-serverless-utils/plugins/documentation

custom:
  documentation:
    schemasPath: src/schemas/schemas.js
    errorsPath: src/utils/errors.js
    version: "1"
    title: Example API
    description: OpenAPI documentation.
```

To generate the documentation execute:

```bash
$ npx sls openapi generate -o docs/openapi.json
```

This plugin uses Joi schemas exported by the serverless functions to generate the valid openapi paths. `schemasPath` and `errorsPath` are used to provide default schemas such us generic errors reponses.

More information can be found in the [example](/example) directory.

### Bruno Plugin

Plugin to generate a [bruno](https://github.com/usebruno/bruno) spec based on the serverless functions.

> Documentation plugin is required.

Add to your `serverless.yml`

```yml
plugins:
  - alliants-serverless-utils/plugins/documentation
  - alliants-serverless-utils/plugins/bruno

custom:
  documentation:
    schemasPath: src/schemas/schemas.js
    errorsPath: src/utils/errors.js
    version: "1"
    title: Example API
    description: OpenAPI documentation.
```

To generate the bruno spec execute:

```bash
$ npx sls bruno generate
```

### Offline SQS Plugin

Plugin to run an instance of SQS locally.

Add to your `serverless.yml`

```yml
plugins:
  - alliants-serverless-utils/plugins/offline-sqs

custom:
  serverless-offline-sqs:
    autoCreate: true
    apiVersion: 2012-11-05
    endpoint: http://localhost:9324
    region: us-east-1
    accessKeyId: root
    secretAccessKey: root
    skipCacheInvalidation: false
  queues:
    test-queue:
      queueName: test_queue
      dlqQueueName: dlq_test_queue
```

After running `sls offline` the plugin is going to start an SQS docker container and you will see a log message like:

`> offline-sqs: http://localhost:<port>`

You can go there to check the queues created in a dashboard.
