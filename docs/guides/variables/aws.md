<!--
title: Serverless Framework - Variables - AWS-specific variables
menuText: AWS-specific variables
menuOrder: 9
description: How to reference AWS-specific variables
layout: Doc
-->

<!-- DOCS-SITE-LINK:START automatically generated  -->

### [Read this on the main serverless docs site](https://www.serverless.com/framework/docs/guides/variables/aws)

<!-- DOCS-SITE-LINK:END -->

# Reference AWS-specific variables

You can reference AWS-specific values as the source of your variables. Those values are exposed via the Serverless Variables system through the `{aws:}` variable prefix.

The following variables are available:

**accountId**

Account ID of you AWS Account, based on the AWS Credentials that you have configured.

```yml
service: new-service
provider:
  name: aws

functions:
  func1:
    name: function-1
    handler: handler.func1
    environment:
      ACCOUNT_ID: ${aws:accountId}
```

**region**

The region used by the Serverless CLI. The `${aws:region}` variable is a shortcut for `${opt:region, self:provider.region, "us-east-1"}`.
