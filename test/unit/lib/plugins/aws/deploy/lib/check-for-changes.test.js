'use strict'

/* eslint-disable no-unused-expressions */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const globby = require('globby')
const sandbox = require('sinon')
const chai = require('chai')
const proxyquire = require('proxyquire')
const normalizeFiles = require('../../../../../../../lib/plugins/aws/lib/normalize-files')
const AwsProvider = require('../../../../../../../lib/plugins/aws/provider')
const AwsDeploy = require('../../../../../../../lib/plugins/aws/deploy/index')
const Serverless = require('../../../../../../../lib/serverless')
const ServerlessError = require('../../../../../../../lib/serverless-error')
const runServerless = require('../../../../../../utils/run-serverless')

const fsp = fs.promises

// Configure chai
chai.use(require('chai-as-promised'))
chai.use(require('sinon-chai'))
const expect = require('chai').expect

describe('checkForChanges', () => {
  let serverless
  let provider
  let awsDeploy
  let s3Key
  let cryptoStub

  beforeEach(() => {
    const options = {
      stage: 'dev',
      region: 'us-east-1',
    }
    serverless = new Serverless({ commands: [], options: {} })
    serverless.serviceDir = 'my-service'
    provider = new AwsProvider(serverless, options)
    serverless.setProvider('aws', provider)
    serverless.service.service = 'my-service'
    serverless.service.provider.shouldNotDeploy = false
    awsDeploy = new AwsDeploy(serverless, options)
    awsDeploy.bucketName = 'deployment-bucket'
    awsDeploy.serverless.service.provider.compiledCloudFormationTemplate = {
      foo: 'bar',
    }
    s3Key = `serverless/${serverless.service.service}/${provider.getStage()}`
    cryptoStub = {
      createHash() {
        return this
      },
      update() {
        return this
      },
      digest: sandbox.stub(),
    }
    const checkForChanges = proxyquire(
      '../../../../../../../lib/plugins/aws/deploy/lib/check-for-changes.js',
      {
        crypto: cryptoStub,
      },
    )
    Object.assign(awsDeploy, checkForChanges)
  })

  describe('#checkForChanges()', () => {
    let getMostRecentObjectsStub
    let getObjectMetadataStub
    let checkIfDeploymentIsNecessaryStub
    let checkLogGroupSubscriptionFilterResourceLimitExceededStub

    beforeEach(() => {
      getMostRecentObjectsStub = sandbox
        .stub(awsDeploy, 'getMostRecentObjects')
        .resolves()
      getObjectMetadataStub = sandbox
        .stub(awsDeploy, 'getObjectMetadata')
        .resolves()
      checkIfDeploymentIsNecessaryStub = sandbox
        .stub(awsDeploy, 'checkIfDeploymentIsNecessary')
        .resolves()
      checkLogGroupSubscriptionFilterResourceLimitExceededStub = sandbox
        .stub(awsDeploy, 'checkLogGroupSubscriptionFilterResourceLimitExceeded')
        .resolves()
    })

    afterEach(() => {
      awsDeploy.getMostRecentObjects.restore()
      awsDeploy.getObjectMetadata.restore()
      awsDeploy.checkIfDeploymentIsNecessary.restore()
      awsDeploy.checkLogGroupSubscriptionFilterResourceLimitExceeded.restore()
      checkLogGroupSubscriptionFilterResourceLimitExceededStub.restore()
    })

    it('should resolve if the "force" option is used', async () => {
      awsDeploy.options.force = true

      return expect(awsDeploy.checkForChanges()).to.be.fulfilled.then(() => {
        expect(getMostRecentObjectsStub).to.not.have.been.called
        expect(getObjectMetadataStub).to.not.have.been.called
        expect(checkIfDeploymentIsNecessaryStub).to.not.have.been.called

        expect(awsDeploy.serverless.service.provider.shouldNotDeploy).to.equal(
          false,
        )
      })
    })
  })

  describe('#getMostRecentObjects()', () => {
    let listObjectsV2Stub

    beforeEach(() => {
      listObjectsV2Stub = sandbox.stub(awsDeploy.provider, 'request')
    })

    afterEach(() => {
      awsDeploy.provider.request.restore()
    })

    it('should translate error if rejected due to missing bucket', () => {
      listObjectsV2Stub.rejects(
        new ServerlessError('The specified bucket does not exist'),
      )

      return expect(awsDeploy.getMostRecentObjects()).to.be.rejectedWith(
        [
          `The serverless deployment bucket "${awsDeploy.bucketName}" does not exist.`,
          'Create it manually if you want to reuse the CloudFormation stack "my-service-dev",',
          'or delete the stack if it is no longer required.',
        ].join(' '),
      )
    })

    it('should throw original error if rejected not due to missing bucket', () => {
      listObjectsV2Stub.rejects(new ServerlessError('Other reason'))
      return expect(awsDeploy.getMostRecentObjects()).to.be.rejectedWith(
        'Other reason',
      )
    })

    it('should resolve if result array is empty', async () => {
      const serviceObjects = {
        Contents: [],
      }

      listObjectsV2Stub.resolves(serviceObjects)

      return expect(awsDeploy.getMostRecentObjects()).to.be.fulfilled.then(
        (result) => {
          expect(listObjectsV2Stub).to.have.been.calledWithExactly(
            'S3',
            'listObjectsV2',
            {
              Bucket: awsDeploy.bucketName,
              Prefix: 'serverless/my-service/dev/',
            },
          )
          expect(result).to.deep.equal([])
        },
      )
    })

    it('should resolve with the most recently deployed objects', async () => {
      const serviceObjects = {
        Contents: [
          { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/artifact.zip` },
          {
            Key: `${s3Key}/151224711231-2016-08-18T15:43:00/cloudformation.json`,
          },
          { Key: `${s3Key}/141264711231-2016-08-18T15:42:00/artifact.zip` },
          {
            Key: `${s3Key}/141264711231-2016-08-18T15:42:00/cloudformation.json`,
          },
        ],
      }

      listObjectsV2Stub.resolves(serviceObjects)

      return expect(awsDeploy.getMostRecentObjects()).to.be.fulfilled.then(
        (result) => {
          expect(listObjectsV2Stub).to.have.been.calledWithExactly(
            'S3',
            'listObjectsV2',
            {
              Bucket: awsDeploy.bucketName,
              Prefix: 'serverless/my-service/dev/',
            },
          )
          expect(result).to.deep.equal([
            {
              Key: `${s3Key}/151224711231-2016-08-18T15:43:00/cloudformation.json`,
            },
            { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/artifact.zip` },
          ])
        },
      )
    })
  })

  describe('#getObjectMetadata()', () => {
    let headObjectStub

    beforeEach(() => {
      headObjectStub = sandbox.stub(awsDeploy.provider, 'request').resolves({})
    })

    afterEach(() => {
      awsDeploy.provider.request.restore()
    })

    it('should resolve if no objects are provided as input', async () => {
      const input = []

      return expect(awsDeploy.getObjectMetadata(input)).to.be.fulfilled.then(
        (result) => {
          expect(headObjectStub).to.not.have.been.called
          expect(result).to.deep.equal([])
        },
      )
    })

    it('should request the object detailed information', async () => {
      const input = [
        { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/artifact.zip` },
        {
          Key: `${s3Key}/151224711231-2016-08-18T15:43:00/cloudformation.json`,
        },
        { Key: `${s3Key}/141264711231-2016-08-18T15:42:00/artifact.zip` },
        {
          Key: `${s3Key}/141264711231-2016-08-18T15:42:00/cloudformation.json`,
        },
      ]

      return expect(awsDeploy.getObjectMetadata(input)).to.be.fulfilled.then(
        () => {
          expect(headObjectStub.callCount).to.equal(4)
          expect(headObjectStub).to.have.been.calledWithExactly(
            'S3',
            'headObject',
            {
              Bucket: awsDeploy.bucketName,
              Key: `${s3Key}/151224711231-2016-08-18T15:43:00/artifact.zip`,
            },
          )
          expect(headObjectStub).to.have.been.calledWithExactly(
            'S3',
            'headObject',
            {
              Bucket: awsDeploy.bucketName,
              Key: `${s3Key}/151224711231-2016-08-18T15:43:00/cloudformation.json`,
            },
          )
          expect(headObjectStub).to.have.been.calledWithExactly(
            'S3',
            'headObject',
            {
              Bucket: awsDeploy.bucketName,
              Key: `${s3Key}/141264711231-2016-08-18T15:42:00/artifact.zip`,
            },
          )
          expect(headObjectStub).to.have.been.calledWithExactly(
            'S3',
            'headObject',
            {
              Bucket: awsDeploy.bucketName,
              Key: `${s3Key}/141264711231-2016-08-18T15:42:00/cloudformation.json`,
            },
          )
        },
      )
    })
  })

  describe('#checkIfDeploymentIsNecessary()', () => {
    let normalizeCloudFormationTemplateStub
    let globbySyncStub
    let readFileStub

    beforeEach(async () => {
      normalizeCloudFormationTemplateStub = sandbox
        .stub(normalizeFiles, 'normalizeCloudFormationTemplate')
        .returns()
      globbySyncStub = sandbox.stub(globby, 'sync')
      readFileStub = sandbox
        .stub(fsp, 'readFile')
        .returns(Promise.resolve('{"service":{"provider":{}},"package":{}}'))
    })

    afterEach(() => {
      normalizeFiles.normalizeCloudFormationTemplate.restore()
      globby.sync.restore()
      fsp.readFile.restore()
    })

    it('should resolve if no input is provided', async () =>
      expect(awsDeploy.checkIfDeploymentIsNecessary([])).to.be.fulfilled.then(
        () => {
          expect(normalizeCloudFormationTemplateStub).to.not.have.been.called
          expect(globbySyncStub).to.not.have.been.called
          expect(readFileStub).to.not.have.been.called
        },
      ))

    it('should resolve if no objects are provided as input', async () => {
      const input = []

      return expect(
        awsDeploy.checkIfDeploymentIsNecessary(input),
      ).to.be.fulfilled.then(() => {
        expect(normalizeCloudFormationTemplateStub).to.not.have.been.called
        expect(globbySyncStub).to.not.have.been.called
        expect(readFileStub).to.not.have.been.called
      })
    })

    it('should resolve if objects are given, but no function last modified date', async () => {
      globbySyncStub.returns(['my-service.zip'])
      cryptoStub
        .createHash()
        .update()
        .digest.onCall(0)
        .returns('local-hash-cf-template')

      const input = [{ Metadata: { filesha256: 'remote-hash-cf-template' } }]

      await awsDeploy.checkIfDeploymentIsNecessary(input)
      expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce
      expect(globbySyncStub).to.have.been.calledOnce
      expect(
        normalizeCloudFormationTemplateStub,
      ).to.have.been.calledWithExactly(
        awsDeploy.serverless.service.provider.compiledCloudFormationTemplate,
      )
      expect(globbySyncStub).to.have.been.calledWithExactly(['**.zip'], {
        cwd: path.join(awsDeploy.serverless.serviceDir, '.serverless'),
        dot: true,
        silent: true,
      })
      expect(readFileStub).to.have.been.calledWith(
        path.resolve(
          awsDeploy.serverless.serviceDir,
          '.serverless/my-service.zip',
        ),
      )
      expect(awsDeploy.serverless.service.provider.shouldNotDeploy).to.equal(
        false,
      )
    })

    it('should not set a flag if there are more remote hashes', async () => {
      globbySyncStub.returns(['my-service.zip'])
      cryptoStub
        .createHash()
        .update()
        .digest.onCall(0)
        .returns('local-hash-cf-template')
      cryptoStub
        .createHash()
        .update()
        .digest.onCall(1)
        .returns('local-hash-zip-file-1')

      const input = [
        { Metadata: { filesha256: 'remote-hash-cf-template' } },
        { Metadata: { filesha256: 'remote-hash-zip-file-1' } },
        {
          Metadata: {
            /* no filesha256 available */
          },
        }, // will be translated to ''
      ]

      return expect(
        awsDeploy.checkIfDeploymentIsNecessary(input),
      ).to.be.fulfilled.then(() => {
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce
        expect(globbySyncStub).to.have.been.calledOnce
        expect(
          normalizeCloudFormationTemplateStub,
        ).to.have.been.calledWithExactly(
          awsDeploy.serverless.service.provider.compiledCloudFormationTemplate,
        )
        expect(globbySyncStub).to.have.been.calledWithExactly(['**.zip'], {
          cwd: path.join(awsDeploy.serverless.serviceDir, '.serverless'),
          dot: true,
          silent: true,
        })
        expect(readFileStub).to.have.been.calledWith(
          path.resolve(
            awsDeploy.serverless.serviceDir,
            '.serverless/my-service.zip',
          ),
        )
        expect(awsDeploy.serverless.service.provider.shouldNotDeploy).to.equal(
          false,
        )
      })
    })

    it('should not set a flag if remote and local hashes are different', async () => {
      globbySyncStub.returns(['my-service.zip'])
      cryptoStub
        .createHash()
        .update()
        .digest.onCall(0)
        .returns('local-hash-cf-template')
      cryptoStub
        .createHash()
        .update()
        .digest.onCall(1)
        .returns('local-hash-zip-file-1')

      const input = [
        { Metadata: { filesha256: 'remote-hash-cf-template' } },
        { Metadata: { filesha256: 'remote-hash-zip-file-1' } },
      ]

      return expect(
        awsDeploy.checkIfDeploymentIsNecessary(input),
      ).to.be.fulfilled.then(() => {
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce
        expect(globbySyncStub).to.have.been.calledOnce
        expect(
          normalizeCloudFormationTemplateStub,
        ).to.have.been.calledWithExactly(
          awsDeploy.serverless.service.provider.compiledCloudFormationTemplate,
        )
        expect(globbySyncStub).to.have.been.calledWithExactly(['**.zip'], {
          cwd: path.join(awsDeploy.serverless.serviceDir, '.serverless'),
          dot: true,
          silent: true,
        })
        expect(readFileStub).to.have.been.calledWith(
          path.resolve(
            awsDeploy.serverless.serviceDir,
            '.serverless/my-service.zip',
          ),
        )
        expect(awsDeploy.serverless.service.provider.shouldNotDeploy).to.equal(
          false,
        )
      })
    })

    it('should not set a flag if remote and local hashes are the same but are duplicated', async () => {
      globbySyncStub.returns(['func1.zip', 'func2.zip'])
      cryptoStub
        .createHash()
        .update()
        .digest.onCall(0)
        .returns('remote-hash-cf-template')
      // happens when package.individually is used
      cryptoStub
        .createHash()
        .update()
        .digest.onCall(1)
        .returns('remote-hash-zip-file-1')
      cryptoStub
        .createHash()
        .update()
        .digest.onCall(2)
        .returns('remote-hash-zip-file-1')

      const input = [
        { Metadata: { filesha256: 'remote-hash-cf-template' } },
        { Metadata: { filesha256: 'remote-hash-zip-file-1' } },
      ]

      return expect(
        awsDeploy.checkIfDeploymentIsNecessary(input),
      ).to.be.fulfilled.then(() => {
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce
        expect(globbySyncStub).to.have.been.calledOnce
        expect(
          normalizeCloudFormationTemplateStub,
        ).to.have.been.calledWithExactly(
          awsDeploy.serverless.service.provider.compiledCloudFormationTemplate,
        )
        expect(globbySyncStub).to.have.been.calledWithExactly(['**.zip'], {
          cwd: path.join(awsDeploy.serverless.serviceDir, '.serverless'),
          dot: true,
          silent: true,
        })
        expect(readFileStub).to.have.been.calledWith(
          path.resolve(
            awsDeploy.serverless.serviceDir,
            '.serverless/func1.zip',
          ),
        )
        expect(readFileStub).to.have.been.calledWith(
          path.resolve(
            awsDeploy.serverless.serviceDir,
            '.serverless/func2.zip',
          ),
        )
        expect(awsDeploy.serverless.service.provider.shouldNotDeploy).to.equal(
          false,
        )
      })
    })

    it('should not set a flag if the hashes are equal, but the objects were modified after their functions', async () => {
      globbySyncStub.returns(['my-service.zip'])
      cryptoStub
        .createHash()
        .update()
        .digest.onCall(0)
        .returns('hash-cf-template')
      cryptoStub
        .createHash()
        .update()
        .digest.onCall(1)
        .returns('hash-zip-file-1')

      const now = new Date()
      const inThePast = new Date(new Date().getTime() - 100000)
      const inTheFuture = new Date(new Date().getTime() + 100000)

      const input = [
        {
          Metadata: { filesha256: 'hash-cf-template' },
          LastModified: inThePast,
        },
        {
          Metadata: { filesha256: 'hash-zip-file-1' },
          LastModified: inTheFuture,
        },
      ]

      return expect(
        awsDeploy.checkIfDeploymentIsNecessary(input, now),
      ).to.be.fulfilled.then(() => {
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce
        expect(globbySyncStub).to.have.been.calledOnce
        expect(
          normalizeCloudFormationTemplateStub,
        ).to.have.been.calledWithExactly(
          awsDeploy.serverless.service.provider.compiledCloudFormationTemplate,
        )
        expect(globbySyncStub).to.have.been.calledWithExactly(['**.zip'], {
          cwd: path.join(awsDeploy.serverless.serviceDir, '.serverless'),
          dot: true,
          silent: true,
        })
        expect(readFileStub).to.have.been.calledWith(
          path.resolve(
            awsDeploy.serverless.serviceDir,
            '.serverless/my-service.zip',
          ),
        )
        expect(awsDeploy.serverless.service.provider.shouldNotDeploy).to.equal(
          false,
        )
      })
    })

    it('should set a flag if the remote and local hashes are equal', async () => {
      globbySyncStub.returns(['my-service.zip'])
      cryptoStub
        .createHash()
        .update()
        .digest.onCall(0)
        .returns('hash-cf-template')
      cryptoStub.createHash().update().digest.onCall(1).returns('hash-state')
      cryptoStub
        .createHash()
        .update()
        .digest.onCall(2)
        .returns('hash-zip-file-1')

      let fileCounter = 0
      const input = [
        {
          Metadata: { filesha256: 'hash-cf-template' },
          Key: `file${++fileCounter}.zip`,
        },
        {
          Metadata: { filesha256: 'hash-state' },
          Key: `file${++fileCounter}.zip`,
        },
        {
          Metadata: { filesha256: 'hash-zip-file-1' },
          Key: `file${++fileCounter}.zip`,
        },
      ]

      return expect(
        awsDeploy.checkIfDeploymentIsNecessary(input),
      ).to.be.fulfilled.then(() => {
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce
        expect(globbySyncStub).to.have.been.calledOnce
        expect(
          normalizeCloudFormationTemplateStub,
        ).to.have.been.calledWithExactly(
          awsDeploy.serverless.service.provider.compiledCloudFormationTemplate,
        )
        expect(globbySyncStub).to.have.been.calledWithExactly(['**.zip'], {
          cwd: path.join(awsDeploy.serverless.serviceDir, '.serverless'),
          dot: true,
          silent: true,
        })
        expect(readFileStub).to.have.been.calledWith(
          path.resolve(
            awsDeploy.serverless.serviceDir,
            '.serverless/my-service.zip',
          ),
        )
        expect(awsDeploy.serverless.service.provider.shouldNotDeploy).to.equal(
          true,
        )
      })
    })

    it('should set a flag if the remote and local hashes are equal, and the edit times are ordered', async () => {
      globbySyncStub.returns(['my-service.zip'])
      cryptoStub
        .createHash()
        .update()
        .digest.onCall(0)
        .returns('hash-cf-template')
      cryptoStub.createHash().update().digest.onCall(1).returns('hash-state')
      cryptoStub
        .createHash()
        .update()
        .digest.onCall(2)
        .returns('hash-zip-file-1')

      const longAgo = new Date(new Date().getTime() - 100000)
      const longerAgo = new Date(new Date().getTime() - 200000)

      let fileCounter = 0
      const input = [
        {
          Metadata: { filesha256: 'hash-cf-template' },
          LastModified: longerAgo,
          Key: `file${++fileCounter}.zip`,
        },
        {
          Metadata: { filesha256: 'hash-state' },
          LastModified: longerAgo,
          Key: `file${++fileCounter}.zip`,
        },
        {
          Metadata: { filesha256: 'hash-zip-file-1' },
          LastModified: longerAgo,
          Key: `file${++fileCounter}.zip`,
        },
      ]

      return expect(
        awsDeploy.checkIfDeploymentIsNecessary(input, longAgo),
      ).to.be.fulfilled.then(() => {
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce
        expect(globbySyncStub).to.have.been.calledOnce
        expect(
          normalizeCloudFormationTemplateStub,
        ).to.have.been.calledWithExactly(
          awsDeploy.serverless.service.provider.compiledCloudFormationTemplate,
        )
        expect(globbySyncStub).to.have.been.calledWithExactly(['**.zip'], {
          cwd: path.join(awsDeploy.serverless.serviceDir, '.serverless'),
          dot: true,
          silent: true,
        })
        expect(readFileStub).to.have.been.calledWith(
          path.resolve(
            awsDeploy.serverless.serviceDir,
            '.serverless/my-service.zip',
          ),
        )
        expect(awsDeploy.serverless.service.provider.shouldNotDeploy).to.equal(
          true,
        )
      })
    })

    it('should set a flag if the remote and local hashes are duplicated and equal', async () => {
      globbySyncStub.returns(['func1.zip', 'func2.zip'])
      cryptoStub
        .createHash()
        .update()
        .digest.onCall(0)
        .returns('hash-cf-template')
      cryptoStub.createHash().update().digest.onCall(1).returns('hash-state')
      // happens when package.individually is used
      cryptoStub
        .createHash()
        .update()
        .digest.onCall(2)
        .returns('hash-zip-file-1')
      cryptoStub
        .createHash()
        .update()
        .digest.onCall(3)
        .returns('hash-zip-file-1')

      let fileCounter = 0
      const input = [
        {
          Metadata: { filesha256: 'hash-cf-template' },
          Key: `file${++fileCounter}.zip`,
        },
        {
          Metadata: { filesha256: 'hash-state' },
          Key: `file${++fileCounter}.zip`,
        },
        {
          Metadata: { filesha256: 'hash-zip-file-1' },
          Key: `file${++fileCounter}.zip`,
        },
        {
          Metadata: { filesha256: 'hash-zip-file-1' },
          Key: `file${++fileCounter}.zip`,
        },
      ]

      return expect(
        awsDeploy.checkIfDeploymentIsNecessary(input),
      ).to.be.fulfilled.then(() => {
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce
        expect(globbySyncStub).to.have.been.calledOnce
        expect(
          normalizeCloudFormationTemplateStub,
        ).to.have.been.calledWithExactly(
          awsDeploy.serverless.service.provider.compiledCloudFormationTemplate,
        )
        expect(globbySyncStub).to.have.been.calledWithExactly(['**.zip'], {
          cwd: path.join(awsDeploy.serverless.serviceDir, '.serverless'),
          dot: true,
          silent: true,
        })
        expect(readFileStub).to.have.been.calledWith(
          path.resolve(
            awsDeploy.serverless.serviceDir,
            '.serverless/func1.zip',
          ),
        )
        expect(readFileStub).to.have.been.calledWith(
          path.resolve(
            awsDeploy.serverless.serviceDir,
            '.serverless/func2.zip',
          ),
        )
        expect(awsDeploy.serverless.service.provider.shouldNotDeploy).to.equal(
          true,
        )
      })
    })

    it('should not set a flag if the remote and local hashes are different for package.artifact', async () => {
      awsDeploy.serverless.service.package = {
        artifact: 'foo/bar/my-own.zip',
      }

      globbySyncStub.returns([])
      cryptoStub
        .createHash()
        .update()
        .digest.onCall(0)
        .returns('hash-cf-template')
      cryptoStub.createHash().update().digest.onCall(1).returns('hash-state')
      cryptoStub
        .createHash()
        .update()
        .digest.onCall(2)
        .returns('local-my-own-hash')

      let fileCounter = 0
      const input = [
        {
          Metadata: { filesha256: 'hash-cf-template' },
          Key: `file${++fileCounter}.zip`,
        },
        {
          Metadata: { filesha256: 'hash-state' },
          Key: `file${++fileCounter}.zip`,
        },
        {
          Metadata: { filesha256: 'remote-my-own-hash' },
          Key: `file${++fileCounter}.zip`,
        },
      ]

      return expect(
        awsDeploy.checkIfDeploymentIsNecessary(input),
      ).to.be.fulfilled.then(() => {
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce
        expect(globbySyncStub).to.have.been.calledOnce
        expect(
          normalizeCloudFormationTemplateStub,
        ).to.have.been.calledWithExactly(
          awsDeploy.serverless.service.provider.compiledCloudFormationTemplate,
        )
        expect(globbySyncStub).to.have.been.calledWithExactly(['**.zip'], {
          cwd: path.join(awsDeploy.serverless.serviceDir, '.serverless'),
          dot: true,
          silent: true,
        })
        expect(readFileStub).to.have.been.calledWith(
          path.resolve(awsDeploy.serverless.serviceDir, 'foo/bar/my-own.zip'),
        )
        expect(awsDeploy.serverless.service.provider.shouldNotDeploy).to.equal(
          false,
        )
      })
    })
  })
})

describe('checkForChanges #2', () => {
  it('Should recognize package.artifact', async () =>
    runServerless({
      fixture: 'package-artifact',
      command: 'deploy',
      env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
      lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
      awsRequestStubMap: {
        CloudFormation: {
          describeStacks: { Stacks: [{}] },
          describeStackResource: {
            StackResourceDetail: { PhysicalResourceId: 'deployment-bucket' },
          },
        },
        Lambda: {
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
            },
          },
        },
        S3: {
          headObject: {
            Metadata: {
              filesha256: 'RRYyTm4Ri8mocpvx44pvas4JKLYtdJS3Z8MOlrZrDXA=',
            },
          },
          listObjectsV2: {
            Contents: [
              {
                Key: 'serverless/test-package-artifact/dev/1589988704359-2020-05-20T15:31:44.359Z/artifact.zip',
                LastModified: new Date(),
                ETag: '"5102a4cf710cae6497dba9e61b85d0a4"',
                Size: 356,
                StorageClass: 'STANDARD',
              },
            ],
          },
          headBucket: {},
        },
        STS: {
          getCallerIdentity: {
            ResponseMetadata: {
              RequestId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
            },
            UserId: 'XXXXXXXXXXXXXXXXXXXXX',
            Account: '999999999999',
            Arn: 'arn:aws:iam::999999999999:user/test',
          },
        },
      },
    }).then(({ cfTemplate }) => {
      expect(
        cfTemplate.Resources.FooLambdaFunction.Properties.Code.S3Key.endsWith(
          '/artifact.zip',
        ),
      ).to.be.true
    }))
})

const commonAwsSdkMock = {
  CloudFormation: {
    describeStacks: { Stacks: [{}] },
    describeStackResource: {
      StackResourceDetail: { PhysicalResourceId: 'deployment-bucket' },
    },
  },
  STS: {
    getCallerIdentity: {
      ResponseMetadata: { RequestId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
      UserId: 'XXXXXXXXXXXXXXXXXXXXX',
      Account: '999999999999',
      Arn: 'arn:aws:iam::999999999999:user/test',
    },
  },
}

const generateMatchingListObjectsResponse = async (serverless) => {
  const packagePath = path.resolve(serverless.serviceDir, '.serverless')
  const artifactNames = (await globby('*.zip', { cwd: packagePath })).map(
    (filename) => path.basename(filename),
  )
  artifactNames.push(
    'compiled-cloudformation-template.json',
    'serverless-state.json',
  )
  return {
    Contents: [
      {
        Key: 'serverless/test-package-artifact/dev/code-artifacts/sls-otel.0.2.2.zip',
        LastModified: new Date('2020-05-20T15:30:16.494+0000'),
      },
      ...artifactNames.map((artifactName) => ({
        Key: `serverless/test-package-artifact/dev/1589988704359-2020-05-20T15:31:44.359Z/${artifactName}`,
        LastModified: new Date('2020-05-20T15:30:16.494+0000'),
      })),
    ],
  }
}

const generateMatchingHeadObjectResponse = async (serverless, { Key: key }) => {
  if (path.basename(key) === 'compiled-cloudformation-template.json') {
    const compiledCfTemplate =
      serverless.service.provider.compiledCloudFormationTemplate
    const normCfTemplate =
      normalizeFiles.normalizeCloudFormationTemplate(compiledCfTemplate)
    const fileHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(normCfTemplate))
      .digest('base64')
    return {
      Metadata: { filesha256: fileHash },
    }
  }
  if (path.basename(key) === 'serverless-state.json') {
    const provider = serverless.getProvider('aws')
    const basename = provider.naming.getServiceStateFileName()
    const content = await fsp.readFile(
      path.join(serverless.serviceDir, '.serverless', basename),
      'utf-8',
    )

    const stateObject = JSON.parse(content)
    const fileHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(normalizeFiles.normalizeState(stateObject)))
      .digest('base64')
    return {
      Metadata: { filesha256: fileHash },
    }
  }
  const fileHash = await (async (basename) => {
    return new Promise((resolve) => {
      const hash = crypto.createHash('sha256')
      const f = fs.createReadStream(
        `${serverless.serviceDir}/.serverless/${basename}`,
      )
      f.on('data', (d) => hash.update(d))
      f.on('close', () => resolve(hash.digest('base64')))
    })
  })(path.basename(key))
  return {
    Metadata: { filesha256: fileHash },
  }
}

describe('test/unit/lib/plugins/aws/deploy/lib/checkForChanges.test.js', () => {
  // Note: Deploy is skipped if:
  // 1. Generated cloudFormation stack is same as one previously deployed (with normalization applied that clears random and time generated values)
  // 2. Collection of generated artifacts (any in package folder) is exactly same (hashes are compared) as one uploaded to S3 bucket with last deployment
  // 3. There's no "--force" CLI param used
  // 4. All Deployed functions configuration modification dates are newer than S3 uploaded artifacts modification dates (if it's not the case, it may mean that previous deployment failed, and in such situation we should deploy unconditionally)

  it.skip('TODO: should not deploy if artifacts in bucket are same as locally and modification dates for all functions are later than uploaded artifacts dates', async () => {
    // Replaces:
    // https://github.com/serverless/serverless/blob/11fb14115ea47d53a61fa666a94e60d585fb3a4d/test/unit/lib/plugins/aws/deploy/lib/checkForChanges.test.js#L223-L250
    // https://github.com/serverless/serverless/blob/11fb14115ea47d53a61fa666a94e60d585fb3a4d/test/unit/lib/plugins/aws/deploy/lib/checkForChanges.test.js#L451-L550

    let serverless
    await runServerless({
      fixture: 'check-for-changes',
      command: 'deploy',
      lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
      env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
      hooks: {
        beforeInstanceInit: (serverlessInstance) =>
          (serverless = serverlessInstance),
      },
      awsRequestStubMap: {
        ...commonAwsSdkMock,
        // 1. Returns function configuration modification date.
        //    Must be newer than artificats (in S3 folder) modification dates
        Lambda: {
          getFunction: {
            Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' },
          },
        },
        S3: {
          // 2. Lists all S3 bucket files with their modification dates
          //    In S3 folder with latest date stamp:
          //    - Collection need to match collection of artifacts in package folder
          //    - LastModified date needs to be older than modification date of any function configuration
          listObjectsV2: async () =>
            generateMatchingListObjectsResponse(serverless),
          // 3. Lists hashes for all S3 buckets
          //    Should match hashes fo artifacts in package folder
          headObject: async (params) =>
            generateMatchingHeadObjectResponse(serverless, params),
        },
      },
    })

    expect(serverless.service.provider.shouldNotDeploy).to.equal(true)
  })

  it.skip('TODO: should deploy with --force option', async () => {
    // Replaces:
    // https://github.com/serverless/serverless/blob/11fb14115ea47d53a61fa666a94e60d585fb3a4d/test/unit/lib/plugins/aws/deploy/lib/checkForChanges.test.js#L101-L111

    let serverless
    await runServerless({
      fixture: 'check-for-changes',
      command: 'deploy',
      options: { force: true },
      lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
      env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
      hooks: {
        beforeInstanceInit: (serverlessInstance) =>
          (serverless = serverlessInstance),
      },
      awsRequestStubMap: {
        ...commonAwsSdkMock,
        Lambda: {
          getFunction: {
            Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' },
          },
        },
        S3: {
          listObjectsV2: async () =>
            generateMatchingListObjectsResponse(serverless),
          headObject: async (params) =>
            generateMatchingHeadObjectResponse(serverless, params),
        },
      },
    })

    expect(serverless.service.provider.shouldNotDeploy).to.equal(false)
  })

  it.skip('TODO: should deploy when deployment bucket is empty (first deployment)', async () => {
    // Replaces:
    // https://github.com/serverless/serverless/blob/11fb14115ea47d53a61fa666a94e60d585fb3a4d/test/unit/lib/plugins/aws/deploy/lib/checkForChanges.test.js#L125-L135
    // https://github.com/serverless/serverless/blob/11fb14115ea47d53a61fa666a94e60d585fb3a4d/test/unit/lib/plugins/aws/deploy/lib/checkForChanges.test.js#L156-L170
    // https://github.com/serverless/serverless/blob/61dd3bde8d17cdd995fdd27259a689d12bee1e42/test/unit/lib/plugins/aws/deploy/lib/checkForChanges.test.js#L208-L221
    // https://github.com/serverless/serverless/blob/11fb14115ea47d53a61fa666a94e60d585fb3a4d/test/unit/lib/plugins/aws/deploy/lib/checkForChanges.test.js#L272-L289

    const { serverless } = await runServerless({
      fixture: 'packageFoldern',
      command: 'deploy',
      lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
      env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
      awsRequestStubMap: {
        ...commonAwsSdkMock,
        Lambda: {
          // TODO: Reflect function doesn't exist crash
          getFunction: async () => {},
        },
        S3: {
          // TODO: Reflect state after bucket creation, when bucket is empty
          listObjectsV2: async () => {},
        },
      },
    })

    expect(serverless.service.provider.shouldNotDeploy).to.equal(false)
  })

  it.skip('TODO: should compare against latest deployment artifacts', async () => {
    // Replaces:
    // https://github.com/serverless/serverless/blob/11fb14115ea47d53a61fa666a94e60d585fb3a4d/test/unit/lib/plugins/aws/deploy/lib/checkForChanges.test.js#L172-L194

    let serverless
    await runServerless({
      fixture: 'check-for-changes',
      command: 'deploy',
      lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
      env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
      hooks: {
        beforeInstanceInit: (serverlessInstance) =>
          (serverless = serverlessInstance),
      },
      awsRequestStubMap: {
        ...commonAwsSdkMock,
        Lambda: {
          getFunction: {
            Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' },
          },
        },
        S3: {
          // TODO: Enrich the result as generated by "generateMatchingListObjectsResponse" to
          // additiona list same artifacts (but with different hashes) in older deployment folder
          listObjectsV2: async () =>
            generateMatchingListObjectsResponse(serverless),
          headObject: async (params) =>
            generateMatchingHeadObjectResponse(serverless, params),
        },
      },
    })

    expect(serverless.service.provider.shouldNotDeploy).to.equal(true)
  })

  it.skip('TODO: should deploy if new function was introduced and otherwise there were no other changes', async () => {
    // Replaces:
    // https://github.com/serverless/serverless/blob/11fb14115ea47d53a61fa666a94e60d585fb3a4d/test/unit/lib/plugins/aws/deploy/lib/checkForChanges.test.js#L291-L314
    // https://github.com/serverless/serverless/blob/61dd3bde8d17cdd995fdd27259a689d12bee1e42/test/unit/lib/plugins/aws/deploy/lib/checkForChanges.test.js#L854-L882

    let serverless
    await runServerless({
      fixture: 'check-for-changes',
      command: 'deploy',
      lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
      env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
      hooks: {
        beforeInstanceInit: (serverlessInstance) =>
          (serverless = serverlessInstance),
      },
      awsRequestStubMap: {
        ...commonAwsSdkMock,
        Lambda: {
          // TODO: Reject request for one function with function not found error
          getFunction: () => {},
        },
        S3: {
          listObjectsV2: async () =>
            generateMatchingListObjectsResponse(serverless),
          headObject: async (params) =>
            generateMatchingHeadObjectResponse(serverless, params),
        },
      },
    })

    expect(serverless.service.provider.shouldNotDeploy).to.equal(false)
  })

  it.skip('TODO: should deploy if individually packaged function was removed', async () => {
    // Replaces:
    // https://github.com/serverless/serverless/blob/11fb14115ea47d53a61fa666a94e60d585fb3a4d/test/unit/lib/plugins/aws/deploy/lib/checkForChanges.test.js#L317-L350

    const {
      fixtureData: { updateConfig, servicePath: serviceDir },
    } = await runServerless({
      fixture: 'check-for-changes',
      command: 'package',
    })

    const listObjectsV2Response =
      await generateMatchingListObjectsResponse(serverless)
    await updateConfig({ functions: { fnIndividually: null } })

    let serverless
    await runServerless({
      cwd: serviceDir,
      command: 'package',
      lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
      env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
      hooks: {
        beforeInstanceInit: (serverlessInstance) =>
          (serverless = serverlessInstance),
      },
      awsRequestStubMap: {
        ...commonAwsSdkMock,
        Lambda: {
          getFunction: {
            Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' },
          },
        },
        S3: {
          listObjectsV2: () => listObjectsV2Response,
          // TODO: Ensure hash for no longer existing artificat
          headObject: async (params) =>
            generateMatchingHeadObjectResponse(serverless, params),
        },
      },
    })

    expect(serverless.service.provider.shouldNotDeploy).to.equal(false)
  })

  it.skip('TODO: should deploy if remote hashes are different', async () => {
    // Replaces:
    // https://github.com/serverless/serverless/blob/11fb14115ea47d53a61fa666a94e60d585fb3a4d/test/unit/lib/plugins/aws/deploy/lib/checkForChanges.test.js#L352-L380

    let serverless
    await runServerless({
      fixture: 'check-for-changes',
      command: 'deploy',
      lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
      env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
      hooks: {
        beforeInstanceInit: (serverlessInstance) =>
          (serverless = serverlessInstance),
      },
      awsRequestStubMap: {
        ...commonAwsSdkMock,
        Lambda: {
          getFunction: {
            Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' },
          },
        },
        S3: {
          listObjectsV2: async () =>
            generateMatchingListObjectsResponse(serverless),
          // TODO: Tweak one artifact hash to be different
          headObject: async (params) =>
            generateMatchingHeadObjectResponse(serverless, params),
        },
      },
    })

    expect(serverless.service.provider.shouldNotDeploy).to.equal(false)
  })

  it.skip('TODO: should deploy if count of hashes (not their content) differs', async () => {
    // Replaces:
    // https://github.com/serverless/serverless/blob/11fb14115ea47d53a61fa666a94e60d585fb3a4d/test/unit/lib/plugins/aws/deploy/lib/checkForChanges.test.js#L382-L415

    let serverless
    await runServerless({
      fixture: 'check-for-changes',
      command: 'deploy',
      configExt: {
        package: { individually: true },
      },
      lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
      env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
      hooks: {
        beforeInstanceInit: (serverlessInstance) =>
          (serverless = serverlessInstance),
      },
      awsRequestStubMap: {
        ...commonAwsSdkMock,
        Lambda: {
          getFunction: {
            Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' },
          },
        },
        S3: {
          // TODO: Remove one result hash
          listObjectsV2: async () =>
            generateMatchingListObjectsResponse(serverless),
          headObject: async (params) =>
            generateMatchingHeadObjectResponse(serverless, params),
        },
      },
    })

    expect(serverless.service.provider.shouldNotDeploy).to.equal(false)
  })

  it.skip('TODO: should deploy if uploaded artifacts are newer than function configuration modification date', async () => {
    // Replaces:
    // https://github.com/serverless/serverless/blob/11fb14115ea47d53a61fa666a94e60d585fb3a4d/test/unit/lib/plugins/aws/deploy/lib/checkForChanges.test.js#L417-L449
    // https://github.com/serverless/serverless/blob/61dd3bde8d17cdd995fdd27259a689d12bee1e42/test/unit/lib/plugins/aws/deploy/lib/checkForChanges.test.js#L884-L924

    let serverless
    await runServerless({
      fixture: 'check-for-changes',
      command: 'deploy',
      configExt: {
        package: { individually: true },
      },
      lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
      env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
      hooks: {
        beforeInstanceInit: (serverlessInstance) =>
          (serverless = serverlessInstance),
      },
      awsRequestStubMap: {
        ...commonAwsSdkMock,
        Lambda: {
          getFunction: () => {
            // TODO: For *one* function return date that is older than one of uploaded artifacts
          },
        },
        S3: {
          listObjectsV2: async () =>
            generateMatchingListObjectsResponse(serverless),
          headObject: async (params) =>
            generateMatchingHeadObjectResponse(serverless, params),
        },
      },
    })

    expect(serverless.service.provider.shouldNotDeploy).to.equal(false)
  })

  it.skip('TODO: should deploy if custom package.artifact have changed', async () => {
    // Replaces:
    // https://github.com/serverless/serverless/blob/61dd3bde8d17cdd995fdd27259a689d12bee1e42/test/unit/lib/plugins/aws/deploy/lib/checkForChanges.test.js#L552-L585
    // https://github.com/serverless/serverless/blob/61dd3bde8d17cdd995fdd27259a689d12bee1e42/test/unit/lib/plugins/aws/deploy/lib/checkForChanges.test.js#L929-L978

    let serverless
    await runServerless({
      fixture: 'check-for-changes',
      command: 'deploy',
      configExt: {
        package: { artifact: 'artifact.zip' },
      },
      lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
      env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
      hooks: {
        beforeInstanceInit: (serverlessInstance) =>
          (serverless = serverlessInstance),
      },
      awsRequestStubMap: {
        ...commonAwsSdkMock,
        Lambda: {
          getFunction: {
            Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' },
          },
        },
        S3: {
          // TODO: Ensure to list "artifact.js"
          listObjectsV2: async () =>
            generateMatchingListObjectsResponse(serverless),
          // TODO: Cover "artifact.js" with not matching hash
          headObject: async (params) =>
            generateMatchingHeadObjectResponse(serverless, params),
        },
      },
    })

    expect(serverless.service.provider.shouldNotDeploy).to.equal(false)
  })

  it('should skip a deployment with identical hashes and package.artifact targeting .serverless directory', async () => {
    let serverless
    await runServerless({
      fixture: 'package-artifact-in-serverless-dir',
      command: 'deploy',
      configExt: {
        // runServerless by default makes this: `test-${fixtureName}-${TIME_BASED_HASH}`
        // for safety of concurrent test runs. Unfortunately this will make our
        // normalized CF template values **different** in a way that defeats the entire
        // purpose of this test. So, for this test only, use a single, deterministic
        // service name to allow consistent, known hashing.
        service: 'test-packageArtifactInServerlessDir',
      },
      env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
      lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
      hooks: {
        beforeInstanceInit: (serverlessInstance) =>
          (serverless = serverlessInstance),
      },
      awsRequestStubMap: {
        ...commonAwsSdkMock,
        Lambda: {
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
            },
          },
        },
        S3: {
          headBucket: {},
          headObject: async (params) =>
            generateMatchingHeadObjectResponse(serverless, params),
          listObjectsV2: async () =>
            generateMatchingListObjectsResponse(serverless),
        },
      },
    })
    expect(serverless.service.provider.shouldNotDeploy).to.equal(true)
  })

  it.skip('TODO: should crash meaningfully if bucket does not exist', () => {
    // Replaces:
    // https://github.com/serverless/serverless/blob/11fb14115ea47d53a61fa666a94e60d585fb3a4d/test/unit/lib/plugins/aws/deploy/lib/checkForChanges.test.js#L137-L149

    return expect(
      runServerless({
        fixture: 'check-for-changes',
        command: 'deploy',
        lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
        env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
        awsRequestStubMap: {
          ...commonAwsSdkMock,
          S3: {
            // TODO: Reflect bucket does not exist crash
            listObjectsV2: async () => {},
          },
        },
      }),
    ).to.eventually.be.rejected.and.have.property(
      'code',
      // TODO: Fill with expected error code
    )
  })

  it.skip('TODO: should handle gently other AWS SDK errors', () => {
    // Replaces:
    // https://github.com/serverless/serverless/blob/11fb14115ea47d53a61fa666a94e60d585fb3a4d/test/unit/lib/plugins/aws/deploy/lib/checkForChanges.test.js#L151-L154

    return expect(
      runServerless({
        fixture: 'check-for-changes',
        command: 'deploy',
        lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
        env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
        awsRequestStubMap: {
          ...commonAwsSdkMock,
          S3: {
            // TODO: Reflect bucket access error
            listObjectsV2: async () => {},
          },
        },
      }),
    ).to.eventually.be.rejected.and.have.property(
      'code',
      // TODO: Fill with expected error code
    )
  })

  it('Should gently handle error of accessing objects from S3 bucket', async () => {
    await expect(
      runServerless({
        fixture: 'check-for-changes',
        command: 'deploy',
        lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
        env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
        awsRequestStubMap: {
          ...commonAwsSdkMock,
          S3: {
            headObject: () => {
              const err = new Error('err')
              err.code = 'AWS_S3_HEAD_OBJECT_FORBIDDEN'
              throw err
            },
            headBucket: () => {},
            listObjectsV2: () => {
              return {
                Contents: [
                  {
                    Key: 'serverless/test-package-artifact/dev/1589988704359-2020-05-20T15:31:44.359Z/artifact.zip',
                    LastModified: new Date(),
                    ETag: '"5102a4cf710cae6497dba9e61b85d0a4"',
                    Size: 356,
                    StorageClass: 'STANDARD',
                  },
                ],
              }
            },
          },
        },
      }),
    ).to.eventually.be.rejected.and.have.property(
      'code',
      'AWS_S3_HEAD_OBJECT_FORBIDDEN',
    )
  })

  describe('checkLogGroupSubscriptionFilterResourceLimitExceeded', () => {
    it('should not attempt to delete and add filter for same destination', async () => {
      const deleteStub = sandbox.stub()
      let serverless
      await runServerless({
        fixture: 'check-for-changes',
        command: 'deploy',
        configExt: {
          functions: {
            fn1: { events: [{ cloudwatchLog: 'someLogGroupName' }] },
          },
        },
        lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
        env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
        hooks: {
          beforeInstanceInit: (serverlessInstance) =>
            (serverless = serverlessInstance),
        },
        awsRequestStubMap: {
          ...commonAwsSdkMock,
          Lambda: {
            getFunction: {
              Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' },
            },
          },
          S3: {
            listObjectsV2: async () =>
              generateMatchingListObjectsResponse(serverless),
            headObject: async (params) =>
              generateMatchingHeadObjectResponse(serverless, params),
            headBucket: {},
          },
          CloudFormation: {
            ...commonAwsSdkMock.CloudFormation,
            describeStackResource: sandbox
              .stub()
              .onFirstCall()
              .resolves({
                StackResourceDetail: {
                  PhysicalResourceId: 'deployment-bucket',
                },
              })
              .callsFake(async (params) => {
                const naming = serverless.getProvider('aws').naming
                return {
                  StackResourceDetail: {
                    StackName: naming.getStackName(),
                    LogicalResourceId: params.LogicalResourceId,
                    PhysicalResourceId: `${naming.getStackName()}-${
                      params.LogicalResourceId
                    }-xxxxx`,
                  },
                }
              }),
          },
          CloudWatchLogs: {
            deleteSubscriptionFilter: deleteStub,
            describeSubscriptionFilters: async () => {
              const functionName = serverless.service.getFunction('fn1').name
              const naming = serverless.getProvider('aws').naming
              return {
                subscriptionFilters: [
                  {
                    // destinationArn `arn:{partition}:lambda:{region}:{accountId}:function:{functionName}`
                    // filterName {stack name}-{logical id}-{random alphanumeric characters}
                    filterName: `${naming.getStackName()}-${naming.getCloudWatchLogLogicalId(
                      'Fn1',
                      1,
                    )}-xxxxx`,
                    destinationArn: `arn:aws:lambda:us-east-1:999999999999:function:${functionName}`,
                  },
                ],
              }
            },
          },
        },
      })
      expect(deleteStub).to.not.have.been.called
    })

    it('should not attempt to delete filter for 2 subscription filter per log group include externals', async () => {
      const deleteStub = sandbox.stub()
      let serverless
      await runServerless({
        fixture: 'check-for-changes',
        command: 'deploy',
        configExt: {
          functions: {
            fn1: { events: [{ cloudwatchLog: 'someLogGroupName' }] },
          },
        },
        lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
        env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
        hooks: {
          beforeInstanceInit: (serverlessInstance) =>
            (serverless = serverlessInstance),
        },
        awsRequestStubMap: {
          ...commonAwsSdkMock,
          Lambda: {
            getFunction: {
              Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' },
            },
          },
          S3: {
            listObjectsV2: async () =>
              generateMatchingListObjectsResponse(serverless),
            headObject: async (params) =>
              generateMatchingHeadObjectResponse(serverless, params),
            headBucket: {},
          },
          CloudFormation: {
            ...commonAwsSdkMock.CloudFormation,
            describeStackResource: sandbox
              .stub()
              .onFirstCall()
              .resolves({
                StackResourceDetail: {
                  PhysicalResourceId: 'deployment-bucket',
                },
              })
              .callsFake(async (params) => {
                const naming = serverless.getProvider('aws').naming
                throw new Error(
                  `Resource ${
                    params.LogicalResourceId
                  } does not exist for stack ${naming.getStackName()}`,
                )
              }),
          },
          CloudWatchLogs: {
            deleteSubscriptionFilter: deleteStub,
            describeSubscriptionFilters: async () => {
              const naming = serverless.getProvider('aws').naming
              return {
                subscriptionFilters: [
                  {
                    // destinationArn `arn:{partition}:lambda:{region}:{accountId}:function:{functionName}`
                    // filterName {stack name}-{logical id}-{random alphanumeric characters}
                    filterName: `external-stack-dev-${naming.getCloudWatchLogLogicalId(
                      'Fn1',
                      1,
                    )}-xxxxx`,
                    destinationArn:
                      'arn:aws:lambda:us-east-1:999999999999:function:test-checkForChanges-cdr3ogg-dev-fn1',
                  },
                ],
              }
            },
          },
        },
      })
      expect(deleteStub).to.not.have.been.called
    })

    it('should throw an error if external defined subscription filter cause over 2 subscription filter per log group.', async () => {
      const deleteStub = sandbox.stub()
      let serverless
      const promise = runServerless({
        fixture: 'check-for-changes',
        command: 'deploy',
        configExt: {
          functions: {
            fn1: {
              events: [
                { cloudwatchLog: 'someLogGroupName' },
                { cloudwatchLog: 'someLogGroupName' },
              ],
            },
          },
        },
        lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
        env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
        hooks: {
          beforeInstanceInit: (serverlessInstance) =>
            (serverless = serverlessInstance),
        },
        awsRequestStubMap: {
          ...commonAwsSdkMock,
          Lambda: {
            getFunction: {
              Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' },
            },
          },
          S3: {
            listObjectsV2: { Contents: [] },
            headBucket: {},
          },
          CloudFormation: {
            ...commonAwsSdkMock.CloudFormation,
            describeStackResource: sandbox
              .stub()
              .onFirstCall()
              .resolves({
                StackResourceDetail: {
                  PhysicalResourceId: 'deployment-bucket',
                },
              })
              .callsFake(async (params) => {
                const naming = serverless.getProvider('aws').naming
                throw new Error(
                  `Resource ${
                    params.LogicalResourceId
                  } does not exist for stack ${naming.getStackName()}`,
                )
              }),
          },
          CloudWatchLogs: {
            deleteSubscriptionFilter: deleteStub,
            describeSubscriptionFilters: async () => {
              const naming = serverless.getProvider('aws').naming
              return {
                subscriptionFilters: [
                  {
                    // destinationArn `arn:{partition}:lambda:{region}:{accountId}:function:{functionName}`
                    // filterName {stack name}-{logical id}-{random alphanumeric characters}
                    filterName: `external-stack-dev-${naming.getCloudWatchLogLogicalId(
                      'Fn1',
                      1,
                    )}-xxxxx`,
                    destinationArn:
                      'arn:aws:lambda:us-east-1:999999999999:function:test-checkForChanges-cdr3ogg-dev-fn1',
                  },
                ],
              }
            },
          },
        },
      })

      await expect(promise).to.eventually.be.rejected.and.have.property(
        'code',
        'CLOUDWATCHLOG_LOG_GROUP_EVENT_PER_FUNCTION_LIMIT_EXCEEDED',
      )
    })

    it('should attempt to delete subscription filter not match as any of new subscription filter', async () => {
      const deleteStub = sandbox.stub()
      let serverless
      const { awsNaming } = await runServerless({
        fixture: 'check-for-changes',
        command: 'deploy',
        configExt: {
          functions: {
            fn1: { events: [{ cloudwatchLog: 'someLogGroupName' }] },
          },
        },
        lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
        env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
        hooks: {
          beforeInstanceInit: (serverlessInstance) =>
            (serverless = serverlessInstance),
        },
        awsRequestStubMap: {
          ...commonAwsSdkMock,
          Lambda: {
            getFunction: {
              Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' },
            },
          },
          S3: {
            listObjectsV2: { Contents: [] },
            headBucket: {},
          },
          CloudFormation: {
            ...commonAwsSdkMock.CloudFormation,
            describeStackResource: sandbox
              .stub()
              .onFirstCall()
              .resolves({
                StackResourceDetail: {
                  PhysicalResourceId: 'deployment-bucket',
                },
              })
              .callsFake(async (params) => {
                const naming = serverless.getProvider('aws').naming
                return {
                  StackResourceDetail: {
                    StackName: naming.getStackName(),
                    LogicalResourceId: params.LogicalResourceId,
                    PhysicalResourceId: `${naming.getStackName()}-${
                      params.LogicalResourceId
                    }-xxxxx`,
                  },
                }
              }),
          },
          CloudWatchLogs: {
            deleteSubscriptionFilter: deleteStub,
            describeSubscriptionFilters: async () => {
              const naming = serverless.getProvider('aws').naming
              return {
                subscriptionFilters: [
                  {
                    // destinationArn `arn:{partition}:lambda:{region}:{accountId}:function:{functionName}`
                    // filterName {stack name}-{logical id}-{random alphanumeric characters}
                    filterName: `${naming.getStackName()}-${naming.getCloudWatchLogLogicalId(
                      'Fn2',
                      1,
                    )}-xxxxx`,
                    destinationArn:
                      'arn:aws:lambda:us-east-1:999999999999:function:test-checkForChanges-cdr3ogg-dev-fn1',
                  },
                ],
              }
            },
          },
        },
      })
      expect(deleteStub).to.have.been.calledOnceWith({
        logGroupName: 'someLogGroupName',
        filterName: `${awsNaming.getStackName()}-${awsNaming.getCloudWatchLogLogicalId(
          'Fn2',
          1,
        )}-xxxxx`,
      })
    })

    it('should attempt to delete filter if order of cloudwatch events changed', async () => {
      const deleteStub = sandbox.stub()
      let serverless
      const { awsNaming } = await runServerless({
        fixture: 'check-for-changes',
        command: 'deploy',
        configExt: {
          functions: {
            fn1: {
              events: [
                { cloudwatchLog: 'someLogGroupName1' },
                { cloudwatchLog: 'someLogGroupName2' },
              ],
            },
          },
        },
        lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
        env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
        hooks: {
          beforeInstanceInit: (serverlessInstance) =>
            (serverless = serverlessInstance),
        },
        awsRequestStubMap: {
          ...commonAwsSdkMock,
          Lambda: {
            getFunction: {
              Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' },
            },
          },
          S3: {
            listObjectsV2: { Contents: [] },
            headBucket: {},
          },
          CloudFormation: {
            ...commonAwsSdkMock.CloudFormation,
            describeStackResource: sandbox
              .stub()
              .onFirstCall()
              .resolves({
                StackResourceDetail: {
                  PhysicalResourceId: 'deployment-bucket',
                },
              })
              .callsFake(async (params) => {
                const naming = serverless.getProvider('aws').naming
                return {
                  StackResourceDetail: {
                    StackName: naming.getStackName(),
                    LogicalResourceId: params.LogicalResourceId,
                    PhysicalResourceId: `${naming.getStackName()}-${
                      params.LogicalResourceId
                    }-xxxxx`,
                  },
                }
              }),
          },
          CloudWatchLogs: {
            deleteSubscriptionFilter: deleteStub,
            describeSubscriptionFilters: sandbox
              .stub()
              .onFirstCall()
              .callsFake(async () => {
                const functionName = serverless.service.getFunction('fn1').name
                const naming = serverless.getProvider('aws').naming
                return {
                  subscriptionFilters: [
                    {
                      filterName: `${naming.getStackName()}-${naming.getCloudWatchLogLogicalId(
                        'Fn1',
                        1,
                      )}-xxxxx`,
                      destinationArn: `arn:aws:lambda:us-east-1:999999999999:function:${functionName}`,
                    },
                  ],
                }
              })
              .onSecondCall()
              .callsFake(async () => {
                const functionName = serverless.service.getFunction('fn1').name
                const naming = serverless.getProvider('aws').naming
                return {
                  subscriptionFilters: [
                    {
                      // someLogGroupeName2 was previously the first event
                      filterName: `${naming.getStackName()}-${naming.getCloudWatchLogLogicalId(
                        'Fn1',
                        1,
                      )}-xxxxx`,
                      destinationArn: `arn:aws:lambda:us-east-1:999999999999:function:${functionName}`,
                    },
                  ],
                }
              }),
          },
        },
      })
      expect(deleteStub).to.have.been.calledOnceWith({
        logGroupName: 'someLogGroupName2',
        filterName: `${awsNaming.getStackName()}-${awsNaming.getCloudWatchLogLogicalId(
          'Fn1',
          1,
        )}-xxxxx`,
      })
    })

    it('should attempt to delete multiple filters', async () => {
      const deleteStub = sandbox.stub()
      let serverless
      const { awsNaming } = await runServerless({
        fixture: 'check-for-changes',
        command: 'deploy',
        configExt: {
          functions: {
            fn1: {
              events: [
                { cloudwatchLog: 'someLogGroupName' },
                { cloudwatchLog: 'someLogGroupName' },
              ],
            },
          },
        },
        lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
        env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
        hooks: {
          beforeInstanceInit: (serverlessInstance) =>
            (serverless = serverlessInstance),
        },
        awsRequestStubMap: {
          ...commonAwsSdkMock,
          Lambda: {
            getFunction: {
              Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' },
            },
          },
          S3: {
            listObjectsV2: { Contents: [] },
            headBucket: {},
          },
          CloudFormation: {
            ...commonAwsSdkMock.CloudFormation,
            describeStackResource: sandbox
              .stub()
              .onFirstCall()
              .resolves({
                StackResourceDetail: {
                  PhysicalResourceId: 'deployment-bucket',
                },
              })
              .callsFake(async (params) => {
                const naming = serverless.getProvider('aws').naming
                return {
                  StackResourceDetail: {
                    StackName: naming.getStackName(),
                    LogicalResourceId: params.LogicalResourceId,
                    PhysicalResourceId: `${naming.getStackName()}-${
                      params.LogicalResourceId
                    }-xxxxx`,
                  },
                }
              }),
          },
          CloudWatchLogs: {
            deleteSubscriptionFilter: deleteStub,
            describeSubscriptionFilters: sandbox
              .stub()
              .onFirstCall()
              .callsFake(async () => {
                const naming = serverless.getProvider('aws').naming
                return {
                  subscriptionFilters: [
                    {
                      filterName: `${naming.getStackName()}-${naming.getCloudWatchLogLogicalId(
                        'Fn2',
                        1,
                      )}-xxxxx`,
                      destinationArn:
                        'arn:aws:lambda:us-east-1:999999999999:function:test-checkForChanges-cdr3ogg-dev-fn2',
                    },
                    {
                      filterName: `${naming.getStackName()}-${naming.getCloudWatchLogLogicalId(
                        'Fn2',
                        2,
                      )}-xxxxx`,
                      destinationArn:
                        'arn:aws:lambda:us-east-1:999999999999:function:test-checkForChanges-cdr3ogg-dev-fn2',
                    },
                  ],
                }
              }),
          },
        },
      })

      expect(deleteStub).to.have.been.calledTwice
      expect(deleteStub).to.have.been.calledWith({
        logGroupName: 'someLogGroupName',
        filterName: `${awsNaming.getStackName()}-${awsNaming.getCloudWatchLogLogicalId(
          'Fn2',
          1,
        )}-xxxxx`,
      })
      expect(deleteStub).to.have.been.calledWith({
        logGroupName: 'someLogGroupName',
        filterName: `${awsNaming.getStackName()}-${awsNaming.getCloudWatchLogLogicalId(
          'Fn2',
          2,
        )}-xxxxx`,
      })
    })

    it('should recognize custom partition', async () => {
      const deleteStub = sandbox.stub()
      let serverless
      await runServerless({
        fixture: 'check-for-changes',
        command: 'deploy',
        configExt: {
          functions: {
            fn1: { events: [{ cloudwatchLog: 'someLogGroupName' }] },
          },
        },
        lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
        env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
        hooks: {
          beforeInstanceInit: (serverlessInstance) =>
            (serverless = serverlessInstance),
        },
        awsRequestStubMap: {
          ...commonAwsSdkMock,
          STS: {
            getCallerIdentity: {
              ResponseMetadata: {
                RequestId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
              },
              UserId: 'XXXXXXXXXXXXXXXXXXXXX',
              Account: '999999999999',
              Arn: 'arn:aws-us-gov:iam::999999999999:user/test',
            },
          },
          Lambda: {
            getFunction: {
              Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' },
            },
          },
          S3: {
            listObjectsV2: async () =>
              generateMatchingListObjectsResponse(serverless),
            headObject: async (params) =>
              generateMatchingHeadObjectResponse(serverless, params),
            headBucket: {},
          },
          CloudWatchLogs: {
            describeSubscriptionFilters: sandbox.stub().callsFake(async () => {
              const naming = serverless.getProvider('aws').naming
              return {
                subscriptionFilters: [
                  {
                    filterName: `${naming.getStackName()}-${naming.getCloudWatchLogLogicalId(
                      'Fn1',
                      1,
                    )}-xxxxx`,
                    destinationArn: `arn:aws-us-gov:lambda:us-east-1:999999999999:function:${
                      serverless.service.getFunction('fn1').name
                    }`,
                  },
                ],
              }
            }),
            deleteSubscriptionFilter: deleteStub,
          },
        },
      })
      expect(deleteStub).to.not.have.been.called
    })
  })
})
