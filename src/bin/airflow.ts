#!/usr/bin/env node
import * as cdk from '@aws-cdk/core';
import { AirflowAsgStack } from '../lib/asg-stack';
import { AirflowEfsStack } from '../lib/efs-stack';
import { AirflowRoute53Stack } from '../lib/route53-stack';
import { ShareLibStack } from '../lib/shared-stack';

interface Ec2Type {
  pet: Array<string>,
  pet_size: Array<number>,
  sts: string,
  sts_size: Array<number>,
  db: string
};

interface Region {
  pattern: string,
  reg: string,
  vpc_id: string,
  ip: string,
  alb: string,
  vpcSgId: string
  ec2Types: Ec2Type
}


const app = new cdk.App();

const regions: Array<Region> = [
  {
    pattern: 'us', reg: 'us-east-1', vpc_id: 'vpc-ecb25394', ip: '10.0.0.0/16',
    alb: 'us-alb-1870629715.us-east-1.elb.amazonaws.com', vpcSgId: 'sg-0c8461ab50fd7bf54',
    ec2Types: {pet: ['c5a.xlarge', 'c5.xlarge'], pet_size: [2, 2], sts: 'c5a.2xlarge', sts_size: [2, 4], db: 'c5a.xlarge'}
  },
];

for (var val of regions) {
  const sharedStack = new ShareLibStack(
    app, `AirflowSharedStack${val.pattern.toUpperCase()}`, val.pattern, val.vpc_id, val.vpcSgId, {
      description: "Creates shared VPC stack which is lookup from vpc ID and core env for region",
      env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: `${val.reg}`
      }
    }
  );

  const airflowEfs = new AirflowEfsStack(
    app, `AirflowEfsStack${val.pattern.toUpperCase()}`, val.pattern, sharedStack.vpc, val.ip, sharedStack.env_tag, {
      description: "Create EFS with Access point for airflow postgresql",
      env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: `${val.reg}`
      }
    }
  );

  const airflowAsg = new AirflowAsgStack(
    app, `AirflowAsgStack${val.pattern.toUpperCase()}`, val.pattern, sharedStack.vpc, sharedStack.vpcSg,
    val.reg, val.ip, val.ec2Types, sharedStack.env_tag, {
      description: "Create Auto scaling group",
      env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: `${val.reg}`
      }
    }
  );

  const airflowCnameRecord = new AirflowRoute53Stack(
    app, `AirflowCnameRecordStack${val.pattern.toUpperCase()}`, val.pattern, val.reg, val.alb, {
      description: "Create Airflow Cname Record set",
      env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: `${val.reg}`
      }
    }
  )
}
