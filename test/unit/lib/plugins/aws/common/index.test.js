'use strict'

const AwsProvider = require('../../../../../../lib/plugins/aws/provider')
const AwsCommon = require('../../../../../../lib/plugins/aws/common/index')
const Serverless = require('../../../../../../lib/serverless')
const expect = require('chai').expect
const sinon = require('sinon')

describe('AwsCommon', () => {
  let awsCommon
  beforeEach(() => {
    const serverless = new Serverless({ commands: [], options: {} })
    const options = {
      stage: 'dev',
      region: 'us-east-1',
    }
    serverless.setProvider('aws', new AwsProvider(serverless, options))
    serverless.serviceDir = 'foo'
    awsCommon = new AwsCommon(serverless, options)
    awsCommon.serverless.cli = new serverless.classes.CLI()
  })

  describe('#constructor()', () => {
    it('should have hooks', () => expect(awsCommon.hooks).to.be.not.empty)

    it('should have commands', () => expect(awsCommon.commands).to.be.not.empty)

    it('should set the provider variable to an instance of AwsProvider', () =>
      expect(awsCommon.provider).to.be.instanceof(AwsProvider))
  })

  describe('hooks', () => {
    describe('aws:common:validate:validate', () => {
      it('should call validate', async () => {
        const validateStub = sinon.stub(awsCommon, 'validate').resolves()

        return awsCommon.hooks['aws:common:validate:validate']().then(() => {
          expect(validateStub.calledOnce).to.be.equal(true)
        })
      })
    })

    describe('aws:common:cleanupTempDir:cleanup', () => {
      it('should call cleanupTempDir', async () => {
        const cleanupTempDirStub = sinon
          .stub(awsCommon, 'cleanupTempDir')
          .resolves()

        return awsCommon.hooks['aws:common:cleanupTempDir:cleanup']().then(
          () => {
            expect(cleanupTempDirStub.calledOnce).to.be.equal(true)
          },
        )
      })
    })

    describe('aws:common:moveArtifactsToPackage:move', () => {
      it('should call cleanupTempDir', async () => {
        const moveArtifactsToPackageStub = sinon
          .stub(awsCommon, 'moveArtifactsToPackage')
          .resolves()

        return awsCommon.hooks['aws:common:moveArtifactsToPackage:move']().then(
          () => {
            expect(moveArtifactsToPackageStub.calledOnce).to.be.equal(true)
          },
        )
      })
    })

    describe('aws:common:moveArtifactsToTemp:move', () => {
      it('should call cleanupTempDir', async () => {
        const moveArtifactsToTempStub = sinon
          .stub(awsCommon, 'moveArtifactsToTemp')
          .resolves()

        return awsCommon.hooks['aws:common:moveArtifactsToTemp:move']().then(
          () => {
            expect(moveArtifactsToTempStub.calledOnce).to.be.equal(true)
          },
        )
      })
    })
  })

  describe('commands', () => {
    it('should be only entrypoints', () => {
      expect(awsCommon.commands).to.have.nested.property(
        'aws.type',
        'entrypoint',
      )
    })

    describe('aws:common:validate', () => {
      it('should exist', () => {
        expect(awsCommon.commands).to.have.nested.property(
          'aws.commands.common.commands.validate',
        )
      })
    })

    describe('aws:common:cleanupTempDir', () => {
      it('should exist', () => {
        expect(awsCommon.commands).to.have.nested.property(
          'aws.commands.common.commands.cleanupTempDir',
        )
      })
    })

    describe('aws:common:moveArtifactsToPackage', () => {
      it('should exist', () => {
        expect(awsCommon.commands).to.have.nested.property(
          'aws.commands.common.commands.moveArtifactsToPackage',
        )
      })
    })

    describe('aws:common:moveArtifactsToTemp', () => {
      it('should exist', () => {
        expect(awsCommon.commands).to.have.nested.property(
          'aws.commands.common.commands.moveArtifactsToTemp',
        )
      })
    })
  })
})
