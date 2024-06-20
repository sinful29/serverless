'use strict'

const { expect } = require('chai')
const log = require('log').get('serverless:test')
const fixtures = require('../../fixtures/programmatic')

const {
  createBucket,
  createAndRemoveInBucket,
  deleteBucket,
} = require('../../utils/s3')
const { deployService, removeService } = require('../../utils/integration')
const { confirmCloudWatchLogs } = require('../../utils/misc')

describe('AWS - S3 Integration Test', function () {
  this.timeout(1000 * 60 * 10) // Involves time-taking deploys
  let stackName
  let serviceDir
  let bucketMinimalSetup
  let bucketExtendedSetup
  let bucketCustomName
  let bucketExistingSimpleSetup
  let bucketExistingComplexSetup
  const stage = 'dev'

  before(async () => {
    const serviceData = await fixtures.setup('s3')
    ;({ servicePath: serviceDir } = serviceData)
    const serviceName = serviceData.serviceConfig.service
    bucketMinimalSetup = `${serviceName}-s3-minimal`
    bucketExtendedSetup = `${serviceName}-s3-extended`
    bucketCustomName = `${serviceName}-custom-bucket-${stage}`
    bucketExistingSimpleSetup = `${serviceName}-s3-existing-simple`
    bucketExistingComplexSetup = `${serviceName}-s3-existing-complex`
    stackName = `${serviceName}-${stage}`
    // create external S3 buckets
    // NOTE: deployment can only be done once the S3 buckets are created
    log.notice('Creating S3 buckets...')
    await Promise.all([
      createBucket(bucketExistingSimpleSetup),
      createBucket(bucketExistingComplexSetup),
    ])
    return deployService(serviceDir)
  })

  after(async () => {
    await removeService(serviceDir)
    return Promise.all([
      deleteBucket(bucketExistingSimpleSetup),
      deleteBucket(bucketExistingComplexSetup),
    ])
  })

  describe('Minimal Setup', () => {
    it('should invoke function when an object is created', () => {
      const functionName = 'minimal'
      const expectedMessage = `Hello from S3! - (${functionName})`

      return confirmCloudWatchLogs(
        `/aws/lambda/${stackName}-${functionName}`,
        () => createAndRemoveInBucket(bucketMinimalSetup),
        {
          checkIsComplete: (soFarEvents) => {
            const logs = soFarEvents.reduce(
              (data, event) => data + event.message,
              '',
            )
            return logs.includes('ObjectCreated:Put')
          },
        },
      ).then((events) => {
        const logs = events.reduce((data, event) => data + event.message, '')
        expect(/aws:s3/g.test(logs)).to.equal(true)
        expect(/ObjectCreated:Put/g.test(logs)).to.equal(true)
        expect(logs.includes(expectedMessage)).to.equal(true)
      })
    })
  })

  describe('Extended Setup', () => {
    it('should invoke function when an object is removed', () => {
      const functionName = 'extended'
      const expectedMessage = `Hello from S3! - (${functionName})`

      return confirmCloudWatchLogs(
        `/aws/lambda/${stackName}-${functionName}`,
        () =>
          createAndRemoveInBucket(bucketExtendedSetup, {
            prefix: 'photos/',
            suffix: '.jpg',
          }),
        {
          checkIsComplete: (soFarEvents) => {
            const logs = soFarEvents.reduce(
              (data, event) => data + event.message,
              '',
            )
            return logs.includes('ObjectRemoved:Delete')
          },
        },
      ).then((events) => {
        const logs = events.reduce((data, event) => data + event.message, '')
        expect(/aws:s3/g.test(logs)).to.equal(true)
        expect(/ObjectRemoved:Delete/g.test(logs)).to.equal(true)
        expect(logs.includes(expectedMessage)).to.equal(true)
      })
    })
  })

  describe('Custom Setup', () => {
    it('should invoke function when an object is created', () => {
      const functionName = 'custom'
      const expectedMessage = `Hello from S3! - (${functionName})`

      return confirmCloudWatchLogs(
        `/aws/lambda/${stackName}-${functionName}`,
        () => createAndRemoveInBucket(bucketCustomName),
        {
          checkIsComplete: (soFarEvents) => {
            const logs = soFarEvents.reduce(
              (data, event) => data + event.message,
              '',
            )
            return logs.includes('ObjectCreated:Put')
          },
        },
      ).then((events) => {
        const logs = events.reduce((data, event) => data + event.message, '')
        expect(/aws:s3/g.test(logs)).to.equal(true)
        expect(/ObjectCreated:Put/g.test(logs)).to.equal(true)
        expect(logs.includes(expectedMessage)).to.equal(true)
      })
    })
  })

  describe('Existing Setup', () => {
    describe('Single function / single bucket setup', () => {
      it('should invoke function when an object is created', () => {
        const functionName = 'existing'
        const expectedMessage = `Hello from S3! - (${functionName})`

        return confirmCloudWatchLogs(
          `/aws/lambda/${stackName}-${functionName}`,
          () =>
            createAndRemoveInBucket(bucketExistingSimpleSetup, {
              prefix: 'Files/',
              suffix: '.TXT',
            }),
          {
            checkIsComplete: (soFarEvents) => {
              const logs = soFarEvents.reduce(
                (data, event) => data + event.message,
                '',
              )
              return logs.includes('ObjectCreated:Put')
            },
          },
        ).then((events) => {
          const logs = events.reduce((data, event) => data + event.message, '')
          expect(/aws:s3/g.test(logs)).to.equal(true)
          expect(/ObjectCreated:Put/g.test(logs)).to.equal(true)
          expect(logs.includes(expectedMessage)).to.equal(true)
        })
      })
    })

    describe('Multi function / multi bucket setup', () => {
      it('should invoke function when a .jpg object is created', () => {
        const functionName = 'existingCreated'
        const expectedMessage = `Hello from S3! - (${functionName})`

        return confirmCloudWatchLogs(
          `/aws/lambda/${stackName}-${functionName}`,
          () =>
            createAndRemoveInBucket(bucketExistingComplexSetup, {
              prefix: 'photos',
              suffix: '.jpg',
            }),
          {
            checkIsComplete: (soFarEvents) => {
              const logs = soFarEvents.reduce(
                (data, event) => data + event.message,
                '',
              )
              return logs.includes('ObjectCreated:Put')
            },
          },
        ).then((events) => {
          const logs = events.reduce((data, event) => data + event.message, '')
          expect(/aws:s3/g.test(logs)).to.equal(true)
          expect(/ObjectCreated:Put/g.test(logs)).to.equal(true)
          expect(logs.includes(expectedMessage)).to.equal(true)
        })
      })
      it('should invoke function when a .jpg object is removed', () => {
        const functionName = 'existingRemoved'
        const expectedMessage = `Hello from S3! - (${functionName})`

        return confirmCloudWatchLogs(
          `/aws/lambda/${stackName}-${functionName}`,
          () =>
            createAndRemoveInBucket(bucketExistingComplexSetup, {
              prefix: 'photos',
              suffix: '.jpg',
            }),
          {
            checkIsComplete: (soFarEvents) => {
              const logs = soFarEvents.reduce(
                (data, event) => data + event.message,
                '',
              )
              return logs.includes('ObjectRemoved:Delete')
            },
          },
        ).then((events) => {
          const logs = events.reduce((data, event) => data + event.message, '')
          expect(/aws:s3/g.test(logs)).to.equal(true)
          expect(/ObjectRemoved:Delete/g.test(logs)).to.equal(true)
          expect(logs.includes(expectedMessage)).to.equal(true)
        })
      })
      it('should invoke function when a .png object is created', async () => {
        const functionName = 'existingCreated'
        const expectedMessage = `Hello from S3! - (${functionName})`

        return confirmCloudWatchLogs(
          `/aws/lambda/${stackName}-${functionName}`,
          () =>
            createAndRemoveInBucket(bucketExistingComplexSetup, {
              prefix: 'photos',
              suffix: '.png',
            }),
          {
            checkIsComplete: (soFarEvents) => {
              const logs = soFarEvents.reduce(
                (data, event) => data + event.message,
                '',
              )
              return logs.includes('ObjectCreated:Put')
            },
          },
        ).then((events) => {
          const logs = events.reduce((data, event) => data + event.message, '')
          expect(/aws:s3/g.test(logs)).to.equal(true)
          expect(/ObjectCreated:Put/g.test(logs)).to.equal(true)
          expect(logs.includes(expectedMessage)).to.equal(true)
        })
      })
      it('should invoke function when a .png object is removed', async () => {
        const functionName = 'existingRemoved'
        const expectedMessage = `Hello from S3! - (${functionName})`

        return confirmCloudWatchLogs(
          `/aws/lambda/${stackName}-${functionName}`,
          () =>
            createAndRemoveInBucket(bucketExistingComplexSetup, {
              prefix: 'photos',
              suffix: '.png',
            }),
          {
            checkIsComplete: (soFarEvents) => {
              const logs = soFarEvents.reduce(
                (data, event) => data + event.message,
                '',
              )
              return logs.includes('ObjectRemoved:Delete')
            },
          },
        ).then((events) => {
          const logs = events.reduce((data, event) => data + event.message, '')
          expect(/aws:s3/g.test(logs)).to.equal(true)
          expect(/ObjectRemoved:Delete/g.test(logs)).to.equal(true)
          expect(logs.includes(expectedMessage)).to.equal(true)
        })
      })
    })
  })
})
