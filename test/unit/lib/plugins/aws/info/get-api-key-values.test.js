'use strict'

const expect = require('chai').expect
const sinon = require('sinon')
const AwsInfo = require('../../../../../../lib/plugins/aws/info/index')
const AwsProvider = require('../../../../../../lib/plugins/aws/provider')
const Serverless = require('../../../../../../lib/serverless')

describe('#getApiKeyValues()', () => {
  let serverless
  let awsInfo
  let requestStub

  beforeEach(() => {
    const options = {
      stage: 'dev',
      region: 'us-east-1',
    }
    serverless = new Serverless({ commands: [], options: {} })
    serverless.setProvider('aws', new AwsProvider(serverless, options))
    serverless.service.service = 'my-service'
    awsInfo = new AwsInfo(serverless, options)
    requestStub = sinon.stub(awsInfo.provider, 'request')
  })

  afterEach(() => {
    awsInfo.provider.request.restore()
  })

  it('should add API Key values to this.gatheredData if API key names are available', async () => {
    // set the API Keys for the service
    awsInfo.serverless.service.provider.apiGateway = {
      apiKeys: ['foo', 'bar'],
    }

    awsInfo.gatheredData = {
      info: {},
    }

    requestStub.onCall(0).resolves({
      StackResources: [
        {
          PhysicalResourceId: 'giwn5zgpqj',
          ResourceType: 'AWS::ApiGateway::ApiKey',
        },
        {
          PhysicalResourceId: 'e5wssvzmla',
          ResourceType: 'AWS::ApiGateway::ApiKey',
        },
        {
          PhysicalResourceId: 's3cwoo',
          ResourceType: 'AWS::ApiGateway::Deployment',
        },
      ],
    })

    requestStub
      .onCall(1)
      .resolves({ id: 'giwn5zgpqj', value: 'valueForKeyFoo', name: 'foo' })

    requestStub.onCall(2).resolves({
      id: 'e5wssvzmla',
      value: 'valueForKeyBar',
      name: 'bar',
      description: 'bar description',
      customerId: 'bar customer id',
    })

    const expectedGatheredDataObj = {
      info: {
        apiKeys: [
          {
            customerId: undefined,
            description: undefined,
            name: 'foo',
            value: 'valueForKeyFoo',
          },
          {
            customerId: 'bar customer id',
            description: 'bar description',
            name: 'bar',
            value: 'valueForKeyBar',
          },
        ],
      },
    }

    return awsInfo.getApiKeyValues().then(() => {
      expect(requestStub.calledThrice).to.equal(true)
      expect(awsInfo.gatheredData).to.deep.equal(expectedGatheredDataObj)
    })
  })

  it('should resolve if AWS does not return API key values', async () => {
    // set the API Keys for the service
    awsInfo.serverless.service.provider.apiGateway = {
      apiKeys: ['foo', 'bar'],
    }

    awsInfo.gatheredData = {
      info: {},
    }

    const apiKeyItems = {
      items: [],
    }

    requestStub.resolves(apiKeyItems)

    const expectedGatheredDataObj = {
      info: {
        apiKeys: [],
      },
    }

    return awsInfo.getApiKeyValues().then(() => {
      expect(requestStub.calledOnce).to.equal(true)
      expect(awsInfo.gatheredData).to.deep.equal(expectedGatheredDataObj)
    })
  })

  it('should resolve if API key names are not available', async () => {
    awsInfo.serverless.service.provider.apiGateway = {}

    awsInfo.gatheredData = {
      info: {},
    }

    const expectedGatheredDataObj = {
      info: {
        apiKeys: [],
      },
    }

    return awsInfo.getApiKeyValues().then(() => {
      expect(requestStub.calledOnce).to.equal(false)
      expect(awsInfo.gatheredData).to.deep.equal(expectedGatheredDataObj)
    })
  })
})
