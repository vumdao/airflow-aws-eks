import { IVpc, Vpc, SecurityGroup, ISecurityGroup } from '@aws-cdk/aws-ec2';
import { Stack, App, StackProps } from '@aws-cdk/core';

export class ShareLibStack extends Stack {
    public readonly vpc: IVpc;
    public readonly env_tag: string;
    public readonly vpcSg: ISecurityGroup;

    constructor(scope: App, id: string, pattern: string, vpc_id: string, vpcSgId: string, props?: StackProps) {
        super(scope, id, props);

        // VPC SG to allow ALB
        this.vpcSg = SecurityGroup.fromLookup(this, 'AirflowVPCSG', vpcSgId);

        // Vpc
        this.vpc = Vpc.fromLookup(this, `EfsVPC${pattern.toUpperCase()}`, {
            isDefault: false,
            vpcId: vpc_id
        });

        // Env tag
        this.env_tag = 'prod';
    }
}