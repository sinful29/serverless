'use strict'

const expect = require('chai').expect
const sinon = require('sinon')
const AwsProvider = require('../../../../../../../lib/plugins/aws/provider')
const AwsRemove = require('../../../../../../../lib/plugins/aws/remove/index')
const Serverless = require('../../../../../../../lib/serverless')

describe('removeStack', () => {
  const options = {
    stage: 'dev',
    region: 'us-east-1',
  }
  const serverless = new Serverless({ commands: [], options: {} })
  serverless.service.service = 'removeStack'
  serverless.setProvider('aws', new AwsProvider(serverless, options))

  let awsRemove
  let removeStackStub

  beforeEach(() => {
    awsRemove = new AwsRemove(serverless, options)
    awsRemove.serverless.cli = new serverless.classes.CLI()
    removeStackStub = sinon.stub(awsRemove.provider, 'request').resolves()
  })

  describe('#remove()', () => {
    it('should remove a stack', async () =>
      awsRemove.remove().then(() => {
        expect(removeStackStub.calledOnce).to.be.equal(true)
        expect(
          removeStackStub.calledWithExactly('CloudFormation', 'deleteStack', {
            StackName: `${
              serverless.service.service
            }-${awsRemove.provider.getStage()}`,
          }),
        ).to.be.equal(true)
        awsRemove.provider.request.restore()
      }))

    it('should use CloudFormation service role if it is specified', async () => {
      awsRemove.serverless.service.provider.cfnRole =
        'arn:aws:iam::123456789012:role/myrole'

      return awsRemove.remove().then(() => {
        expect(removeStackStub.args[0][2].RoleARN).to.equal(
          'arn:aws:iam::123456789012:role/myrole',
        )
        awsRemove.provider.request.restore()
      })
    })
  })

  describe('#removeStack()', () => {
    it('should run promise chain in order', async () => {
      const removeStub = sinon.stub(awsRemove, 'remove').resolves()

      return awsRemove.removeStack().then(() => {
        expect(removeStub.calledOnce).to.be.equal(true)
        awsRemove.remove.restore()
      })
    })
  })
})
