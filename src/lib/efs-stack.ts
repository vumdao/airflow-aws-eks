import * as efs from '@aws-cdk/aws-efs';
import * as ec2 from '@aws-cdk/aws-ec2';
import { RemovalPolicy, App, Stack, StackProps, Tags } from '@aws-cdk/core';


export class AirflowEfsStack extends Stack {
  constructor(scope: App, id: string, pattern: string, vpc: ec2.IVpc, ip: string, env_tag: string, props?: StackProps) {
    super(scope, id, props);

    const securityGroup = new ec2.SecurityGroup(this, 'AirflowEfsSG', {
      vpc,
      securityGroupName: `${pattern}-airflow-sg`,
      description: 'Security group for EFS CSI',
      allowAllOutbound: true
    })
    securityGroup.addIngressRule(ec2.Peer.ipv4(ip), ec2.Port.allTraffic(), 'Allow internal private vpc')

    Tags.of(securityGroup).add('Name', `${pattern}-efs-sg`)
    Tags.of(securityGroup).add('cdk:sg:stack', 'sg-stack')
    Tags.of(securityGroup).add('env', env_tag)

    const fileSystem = new efs.FileSystem(
      this, 'AirflowEFS', {
        vpc,
        securityGroup,
        fileSystemName: `${pattern}-airflow-efs`,
        lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
        removalPolicy: RemovalPolicy.DESTROY
      }
    )
    Tags.of(fileSystem).add('Name', `${pattern}-airflow-efs`)
    Tags.of(fileSystem).add('cdk:efs:stack', `${pattern}-efs-${env_tag}`)
    Tags.of(fileSystem).add('env', env_tag)

    const fsAcccessPoint = fileSystem.addAccessPoint(
      `${pattern}EFSAccesPoint`, {
        posixUser: {
          uid: '1001',
          gid: '1001'
        },
        createAcl: {
          ownerUid: '1001',
          ownerGid: '1001',
          permissions: '0700'
        },
        path: '/airflow/data'
      }
    )
    Tags.of(fsAcccessPoint).add('Name', `${pattern}-data-airflow-pg`)
  }
}
