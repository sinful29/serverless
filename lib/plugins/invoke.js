import _ from 'lodash'
import cliCommandsSchema from '../cli/commands-schema.js'

class Invoke {
  constructor(serverless, options) {
    this.serverless = serverless
    this.options = options || {}

    this.commands = {
      invoke: {
        ...cliCommandsSchema.get('invoke'),
        commands: {
          local: {
            ...cliCommandsSchema.get('invoke local'),
          },
        },
      },
    }

    this.hooks = {
      initialize: () => {
        this.options = this.serverless.processedInput.options
      },
      'invoke:local:loadEnvVars': async () => this.loadEnvVarsForLocal(),
      'after:invoke:invoke': async () => this.trackInvoke(),
      'after:invoke:local:invoke': async () => this.trackInvokeLocal(),
    }
  }

  trackInvoke() {
    return
  }

  trackInvokeLocal() {
    return
  }

  /**
   * Set environment variables for "invoke local" that are provider independent.
   */
  loadEnvVarsForLocal() {
    const defaultEnvVars = {
      IS_LOCAL: 'true',
    }

    _.merge(process.env, defaultEnvVars)

    // in some circumstances, setting these provider-independent environment variables is not enough
    // eg. in case of local 'docker' invocation, which relies on this module,
    // these provider-independent environment variables have to be propagated to the container
    this.serverless.service.provider.environment =
      this.serverless.service.provider.environment || {}
    const providerEnv = this.serverless.service.provider.environment
    for (const [envVariableKey, envVariableValue] of Object.entries(
      defaultEnvVars,
    )) {
      if (!Object.prototype.hasOwnProperty.call(providerEnv, envVariableKey)) {
        providerEnv[envVariableKey] = envVariableValue
      }
    }

    // Turn zero or more --env options into an array
    //   ...then split --env NAME=value and put into process.env.
    ;[].concat(this.options.env || []).forEach((itm) => {
      const splitItm = itm.split(/=(.+)/)
      process.env[splitItm[0]] = splitItm[1] || ''
    })
  }
}

export default Invoke
