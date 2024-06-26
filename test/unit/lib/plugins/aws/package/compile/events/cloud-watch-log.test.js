'use strict'

const expect = require('chai').expect
const AwsProvider = require('../../../../../../../../lib/plugins/aws/provider')
const AwsCompileCloudWatchLogEvents = require('../../../../../../../../lib/plugins/aws/package/compile/events/cloud-watch-log')
const Serverless = require('../../../../../../../../lib/serverless')
const runServerless = require('../../../../../../../utils/run-serverless')

describe('AwsCompileCloudWatchLogEvents', () => {
  let serverless
  let awsCompileCloudWatchLogEvents

  beforeEach(() => {
    serverless = new Serverless({ commands: [], options: {} })
    serverless.service.provider.compiledCloudFormationTemplate = {
      Resources: {},
    }
    serverless.setProvider('aws', new AwsProvider(serverless))
    awsCompileCloudWatchLogEvents = new AwsCompileCloudWatchLogEvents(
      serverless,
    )
    awsCompileCloudWatchLogEvents.serverless.service.service = 'new-service'
  })

  describe('#constructor()', () => {
    it('should set the provider variable to an instance of AwsProvider', () =>
      expect(awsCompileCloudWatchLogEvents.provider).to.be.instanceof(
        AwsProvider,
      ))
  })

  describe('#compileCloudWatchLogEvents()', () => {
    it('should create corresponding resources when cloudwatchLog events are given', () => {
      awsCompileCloudWatchLogEvents.serverless.service.functions = {
        first: {
          events: [
            {
              cloudwatchLog: {
                logGroup: '/aws/lambda/hello1',
              },
            },
            {
              cloudwatchLog: {
                logGroup: '/aws/lambda/hello2',
              },
            },
          ],
        },
      }

      awsCompileCloudWatchLogEvents.compileCloudWatchLogEvents()
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog1.Type,
      ).to.equal('AWS::Logs::SubscriptionFilter')
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog2.Type,
      ).to.equal('AWS::Logs::SubscriptionFilter')
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog1.Properties.LogGroupName,
      ).to.equal('/aws/lambda/hello1')
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog2.Properties.LogGroupName,
      ).to.equal('/aws/lambda/hello2')
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog1.Properties.FilterPattern,
      ).to.equal('')
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog2.Properties.FilterPattern,
      ).to.equal('')
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLambdaPermissionLogsSubscriptionFilterCloudWatchLog.Type,
      ).to.equal('AWS::Lambda::Permission')
    })

    it('should respect 2 cloudwatchLog events for log group', () => {
      awsCompileCloudWatchLogEvents.serverless.service.functions = {
        first: {
          events: [
            {
              cloudwatchLog: {
                logGroup: '/aws/lambda/hello1',
              },
            },
          ],
        },
        second: {
          events: [
            {
              cloudwatchLog: {
                logGroup: '/aws/lambda/hello1',
              },
            },
          ],
        },
      }

      awsCompileCloudWatchLogEvents.compileCloudWatchLogEvents()
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog1.Type,
      ).to.equal('AWS::Logs::SubscriptionFilter')
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog1.Properties.LogGroupName,
      ).to.equal('/aws/lambda/hello1')
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog1.Properties.FilterPattern,
      ).to.equal('')
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLambdaPermissionLogsSubscriptionFilterCloudWatchLog.Type,
      ).to.equal('AWS::Lambda::Permission')
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .SecondLogsSubscriptionFilterCloudWatchLog1.Type,
      ).to.equal('AWS::Logs::SubscriptionFilter')
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .SecondLogsSubscriptionFilterCloudWatchLog1.Properties.LogGroupName,
      ).to.equal('/aws/lambda/hello1')
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .SecondLogsSubscriptionFilterCloudWatchLog1.Properties.FilterPattern,
      ).to.equal('')
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .SecondLambdaPermissionLogsSubscriptionFilterCloudWatchLog.Type,
      ).to.equal('AWS::Lambda::Permission')
    })

    it('should respect "filter" variable', () => {
      awsCompileCloudWatchLogEvents.serverless.service.functions = {
        first: {
          events: [
            {
              cloudwatchLog: {
                logGroup: '/aws/lambda/hello1',
                filter: '{$.userIdentity.type = Root}',
              },
            },
          ],
        },
      }

      awsCompileCloudWatchLogEvents.compileCloudWatchLogEvents()

      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog1.Properties.FilterPattern,
      ).to.equal('{$.userIdentity.type = Root}')
    })

    it('should respect "filter" variable of plain text', () => {
      awsCompileCloudWatchLogEvents.serverless.service.functions = {
        first: {
          events: [
            {
              cloudwatchLog: {
                logGroup: '/aws/lambda/hello1',
                filter: '"Total amount" -"level=Debug"',
              },
            },
          ],
        },
      }

      awsCompileCloudWatchLogEvents.compileCloudWatchLogEvents()

      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog1.Properties.FilterPattern,
      ).to.equal('"Total amount" -"level=Debug"')
    })

    it('should respect escaped "filter" variable of plain text', () => {
      awsCompileCloudWatchLogEvents.serverless.service.functions = {
        first: {
          events: [
            {
              cloudwatchLog: {
                logGroup: '/aws/lambda/hello1',
                filter: '\\"Total amount\\" -\\"level=Debug\\"',
              },
            },
          ],
        },
      }

      awsCompileCloudWatchLogEvents.compileCloudWatchLogEvents()

      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog1.Properties.FilterPattern,
      ).to.equal('"Total amount" -"level=Debug"')
    })

    it('should set an empty string for FilterPattern statement when "filter" variable is not given', () => {
      awsCompileCloudWatchLogEvents.serverless.service.functions = {
        first: {
          events: [
            {
              cloudwatchLog: {
                logGroup: '/aws/lambda/hello1',
              },
            },
          ],
        },
      }

      awsCompileCloudWatchLogEvents.compileCloudWatchLogEvents()

      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog1.Properties.FilterPattern,
      ).to.equal('')
    })

    it('should create corresponding resources when cloudwatchLog events are given as a string', () => {
      awsCompileCloudWatchLogEvents.serverless.service.functions = {
        first: {
          events: [
            {
              cloudwatchLog: '/aws/lambda/hello1',
            },
            {
              cloudwatchLog: '/aws/lambda/hello2',
            },
          ],
        },
      }

      awsCompileCloudWatchLogEvents.compileCloudWatchLogEvents()
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog1.Type,
      ).to.equal('AWS::Logs::SubscriptionFilter')
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog2.Type,
      ).to.equal('AWS::Logs::SubscriptionFilter')
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog1.Properties.LogGroupName,
      ).to.equal('/aws/lambda/hello1')
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog2.Properties.LogGroupName,
      ).to.equal('/aws/lambda/hello2')
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog1.Properties.FilterPattern,
      ).to.equal('')
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog2.Properties.FilterPattern,
      ).to.equal('')
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLambdaPermissionLogsSubscriptionFilterCloudWatchLog.Type,
      ).to.equal('AWS::Lambda::Permission')
    })

    it('should create a longest-common suffix of logGroup to minimize scope', () => {
      expect(
        awsCompileCloudWatchLogEvents.longestCommonSuffix([
          '/aws/lambda/hello1',
        ]),
      ).to.equal('/aws/lambda/hello1')
      expect(
        awsCompileCloudWatchLogEvents.longestCommonSuffix([
          '/aws/lambda/hello1',
          '/aws/lambda/hello2',
        ]),
      ).to.equal('/aws/lambda/hello*')
      expect(
        awsCompileCloudWatchLogEvents.longestCommonSuffix([
          '/aws/lambda/hello1',
          '/aws/lambda/hot',
        ]),
      ).to.equal('/aws/lambda/h*')
      expect(
        awsCompileCloudWatchLogEvents.longestCommonSuffix([
          '/aws/lambda/hello1',
          '/aws/lambda/tweet',
        ]),
      ).to.equal('/aws/lambda/*')
      expect(
        awsCompileCloudWatchLogEvents.longestCommonSuffix([
          '/aws/lambda/hello1',
          '/aws/lex/log1',
          '/aws/lightsail/log1',
        ]),
      ).to.equal('/aws/l*')
      expect(
        awsCompileCloudWatchLogEvents.longestCommonSuffix([
          '/aws/lambda/hello1',
          '/aws/batch/log1',
        ]),
      ).to.equal('/aws/*')
      expect(
        awsCompileCloudWatchLogEvents.longestCommonSuffix([
          '/aws/*',
          '/aws/lambda/hello',
        ]),
      ).to.equal('/aws/*')
      expect(
        awsCompileCloudWatchLogEvents.longestCommonSuffix([
          '/aws/lambda/*',
          '/aws/lambda/hello',
        ]),
      ).to.equal('/aws/lambda/*')
      expect(
        awsCompileCloudWatchLogEvents.longestCommonSuffix([
          '/aws/lambda',
          '/aws/lambda/hello',
        ]),
      ).to.equal('/aws/lambda*')
      expect(
        awsCompileCloudWatchLogEvents.longestCommonSuffix([
          '/aws/lambda/yada-dev-dummy',
          '/aws/lambda/yada-dev-dummy2',
        ]),
      ).to.equal('/aws/lambda/yada-dev-dummy*')
    })

    it('should throw an error if "logGroup" is configured more than twice in one CloudFormation stack', () => {
      awsCompileCloudWatchLogEvents.serverless.service.functions = {
        first: {
          events: [
            {
              cloudwatchLog: '/aws/lambda/hello1',
            },
            {
              cloudwatchLog: '/aws/lambda/hello2',
            },
            {
              cloudwatchLog: '/aws/lambda/hello1',
            },
            {
              cloudwatchLog: '/aws/lambda/hello1',
            },
          ],
        },
      }

      expect(() =>
        awsCompileCloudWatchLogEvents.compileCloudWatchLogEvents(),
      ).to.throw(Error)

      awsCompileCloudWatchLogEvents.serverless.service.functions = {
        first: {
          events: [
            {
              cloudwatchLog: '/aws/lambda/hello1',
            },
            {
              cloudwatchLog: '/aws/lambda/hello2',
            },
            {
              cloudwatchLog: '/aws/lambda/hello1',
            },
          ],
        },
        second: {
          events: [
            {
              cloudwatchLog: '/aws/lambda/hello1',
            },
          ],
        },
      }

      expect(() =>
        awsCompileCloudWatchLogEvents.compileCloudWatchLogEvents(),
      ).to.throw(Error)
    })

    it('should respect variables if multi-line variables are given', () => {
      awsCompileCloudWatchLogEvents.serverless.service.functions = {
        first: {
          events: [
            {
              cloudwatchLog: {
                logGroup: '/aws/lam\nbda/hello1',
                filter: '{$.userIden\ntity.type = Root}',
              },
            },
          ],
        },
      }

      awsCompileCloudWatchLogEvents.compileCloudWatchLogEvents()

      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog1.Properties.LogGroupName,
      ).to.equal('/aws/lambda/hello1')
      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog1.Properties.FilterPattern,
      ).to.equal('{$.userIdentity.type = Root}')

      awsCompileCloudWatchLogEvents.serverless.service.functions = {
        first: {
          events: [
            {
              cloudwatchLog: '/aws/lam\nbda/hello3',
            },
          ],
        },
      }

      awsCompileCloudWatchLogEvents.compileCloudWatchLogEvents()

      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources
          .FirstLogsSubscriptionFilterCloudWatchLog1.Properties.LogGroupName,
      ).to.equal('/aws/lambda/hello3')
    })

    it('should not create corresponding resources when cloudwatchLog event is not given', () => {
      awsCompileCloudWatchLogEvents.serverless.service.functions = {
        first: {
          events: [{}],
        },
      }

      awsCompileCloudWatchLogEvents.compileCloudWatchLogEvents()

      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources,
      ).to.deep.equal({})
    })

    it('should not create corresponding resources when "events" property is not given', () => {
      awsCompileCloudWatchLogEvents.serverless.service.functions = {
        first: {},
      }

      awsCompileCloudWatchLogEvents.compileCloudWatchLogEvents()

      expect(
        awsCompileCloudWatchLogEvents.serverless.service.provider
          .compiledCloudFormationTemplate.Resources,
      ).to.deep.equal({})
    })
  })
})

describe('test/unit/lib/plugins/aws/package/compile/events/cloud-watch-log.test.js', () => {
  describe('when there are cloud watch log events defined', () => {
    let cfResources

    before(async () => {
      const { cfTemplate } = await runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              events: [
                {
                  cloudwatchLog: {
                    logGroup: '/aws/lambda/hello1',
                  },
                },
              ],
            },
            other: {
              provisionedConcurrency: 1,
              events: [
                {
                  cloudwatchLog: {
                    logGroup: '/aws/lambda/hello1',
                  },
                },
              ],
            },
          },
        },
        command: 'package',
      })
      cfResources = cfTemplate.Resources
    })
    it('should have the filter depend on the cloud watch log', () => {
      expect(
        cfResources.BasicLogsSubscriptionFilterCloudWatchLog1.Type,
      ).to.equal('AWS::Logs::SubscriptionFilter')
      expect(
        cfResources.BasicLogsSubscriptionFilterCloudWatchLog1.DependsOn,
      ).to.eql(['BasicLambdaPermissionLogsSubscriptionFilterCloudWatchLog'])
    })

    it('should have the filter depend on the cloud watch log and the lambda alias', () => {
      expect(
        cfResources.OtherLogsSubscriptionFilterCloudWatchLog1.Type,
      ).to.equal('AWS::Logs::SubscriptionFilter')
      expect(
        cfResources.OtherLogsSubscriptionFilterCloudWatchLog1.DependsOn,
      ).to.eql([
        'OtherLambdaPermissionLogsSubscriptionFilterCloudWatchLog',
        'OtherProvConcLambdaAlias',
      ])
    })

    it('should not have the permission depend on the cloud watch log', () => {
      expect(
        cfResources.BasicLambdaPermissionLogsSubscriptionFilterCloudWatchLog
          .Type,
      ).to.equal('AWS::Lambda::Permission')
      expect(
        cfResources.BasicLambdaPermissionLogsSubscriptionFilterCloudWatchLog
          .DependsOn,
      ).to.be.undefined
    })

    it('should not have the permission depend on the cloud watch log but should depend on the lambda alias', () => {
      expect(
        cfResources.OtherLambdaPermissionLogsSubscriptionFilterCloudWatchLog
          .Type,
      ).to.equal('AWS::Lambda::Permission')
      expect(
        cfResources.OtherLambdaPermissionLogsSubscriptionFilterCloudWatchLog
          .DependsOn,
      ).to.eql(['OtherProvConcLambdaAlias'])
    })
  })
})
