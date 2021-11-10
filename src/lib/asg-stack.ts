import { Stack, App, Tags, StackProps} from '@aws-cdk/core';
import { Cluster, Nodegroup, CapacityType, TaintEffect } from '@aws-cdk/aws-eks'
import { Role, ServicePrincipal, ManagedPolicy, PolicyStatement, Effect, IRole } from '@aws-cdk/aws-iam';
import * as ec2 from '@aws-cdk/aws-ec2';

interface Ec2Type {
    pet: Array<string>,
    pet_size: Array<number>,
    sts: string,
    sts_size: Array<number>,
    db: string
};

export class AirflowAsgStack extends Stack {
    public eks_cluster: any;
    public worker_role: any;
    public airflowSG: any;
    public eksCluserName: string;
    public launchTemplate: any;

    constructor(public scope: App, id: string, public pattern: string, public vpc: ec2.IVpc, public vpcSg: ec2.ISecurityGroup,
                public region: string, public ip: string, ec2_types: Ec2Type, public env_tag: string, props?: StackProps) {
        super(scope, id, props);

        this.eksCluserName = 'us-eks'

        // EKS cluster
        this.eks_cluster = Cluster.fromClusterAttributes(
            this, `EksCluster${pattern.toUpperCase()}`, {
                vpc,
                clusterName: this.eksCluserName
            }
        );

        this.launchTemplate = this.createLaunchTemplate();

        // Airflow-SG to workers
        this.airflowSG = this.createAirflowSG();

        this.worker_role = this.createWorkerRole();

        this.createAsgPet(ec2_types.pet, ec2_types.pet_size);

        this.createAsgSts(ec2_types.sts, ec2_types.sts_size);

        this.createAsgDb(ec2_types.db);

    };

    createWorkerRole(): IRole {
        // Airflow IAM worker role
        const worker_role = new Role(
            this, 'AirflowIamRole', {
                assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
                roleName: `${this.eksCluserName}-airflow`
            }
        );
        const attachPolicies = ['AmazonEC2ContainerRegistryReadOnly', 'AmazonEKSWorkerNodePolicy', 'AmazonS3ReadOnlyAccess', 'AmazonEKS_CNI_Policy'];
        for (var policy of attachPolicies) {
            worker_role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName(policy))
        }
        Tags.of(worker_role).add('Name', `${this.eksCluserName}-airflow`)
        Tags.of(worker_role).add('cdk:iam:stack', `${this.pattern}-iam-${this.env_tag}`)
        Tags.of(worker_role).add('env', this.env_tag)

        const autoscalingStatement = new PolicyStatement({
            sid: 'AutoScalingGroup',
            actions: [
                "autoscaling:DescribeAutoScalingGroups",
                "autoscaling:DescribeAutoScalingInstances",
                "autoscaling:DescribeLaunchConfigurations",
                "autoscaling:DescribeTags",
                "autoscaling:CreateOrUpdateTags",
                "autoscaling:UpdateAutoScalingGroup",
                "autoscaling:TerminateInstanceInAutoScalingGroup",
                "ec2:DescribeLaunchTemplateVersions",
                "elasticfilesystem:*",
                "tag:GetResources",
            ],
            effect: Effect.ALLOW,
            resources: ['*'],
            conditions: {
                'StringEquals': {"aws:RequestedRegion": this.region}
            }
        });

        worker_role.addToPolicy(autoscalingStatement);

        return worker_role;
    };

    createAirflowSG(): any {
        /**
         * Airflow security group
         */
        const airflowSG = new ec2.SecurityGroup(this, 'AirflowairflowSG', {
            vpc: this.vpc,
            securityGroupName: 'airflow-priv-sg',
            description: 'Security group to access to worker in private vpc',
            allowAllOutbound: true
        });
        airflowSG.connections.allowFrom(airflowSG, ec2.Port.allTcp(), 'Allow node to communicate with each other');
        airflowSG.connections.allowFrom(this.vpcSg, ec2.Port.allTcp(), 'Allow nodes in another ASG communicate to airflow nodes');
        /* NOTE: In order for airflow nodes communitcate with others in different ASG, need to allow traffics from airflowSG in vpcSg,
                 due to other nodes are all attached vpcSg
        */
        Tags.of(airflowSG).add('Name', 'airflow-priv-ssh-sg');
        Tags.of(airflowSG).add('cdk:sg:stack', `${this.pattern}-sg-${this.env_tag}`);
        Tags.of(airflowSG).add('env', this.env_tag);

        return airflowSG;
    };

    createLaunchTemplate(): any {
        /**
         * More about launch-templates: https://github.com/awsdocs/amazon-eks-user-guide/blob/master/doc_source/launch-templates.md
         * Notes:
         * - Nodegroup auto-generates role if not specify
         * - Launch template node group automatically add the worker role to aws-auth configmap
        */
        const airflowLaunchTemplate = new ec2.LaunchTemplate(this, 'AirflowLaunchTemplate-lt', {
            launchTemplateName: 'airflow-asg-lt',
            securityGroup: this.airflowSG,
            blockDevices: [{
                deviceName: '/dev/xvda',
                volume: ec2.BlockDeviceVolume.ebs(20)
            }],
            keyName: `${this.pattern}-airflow`
        });
        Tags.of(airflowLaunchTemplate).add('Name', 'airflow-asg-lt');
        Tags.of(airflowLaunchTemplate).add('cdk:lt:stack', `${this.pattern}:lt:${this.env_tag}`);
        Tags.of(airflowLaunchTemplate).add('env', this.env_tag);

        return airflowLaunchTemplate;
    }

    createAsgPet(types: Array<string>, sizes: Array<number>) {
        /**
         * ASG Pet is used to assign deployments. Due to using spot instances so recommendation min size 2
         */
        const asgNodeGroupName = 'eks-airflow-nodegroup-pet';

        const asgPet = new Nodegroup(this, 'AirflowPetAsg', {
            nodegroupName: 'eks-airflow-nodegroup-pet',
            subnets: this.eks_cluster.vpc.selectSubnets({subnetType: ec2.SubnetType.PRIVATE}),
            cluster: this.eks_cluster,
            capacityType: CapacityType.SPOT,
            nodeRole: this.worker_role,
            instanceTypes: [
                new ec2.InstanceType(types[0]),
                new ec2.InstanceType(types[1])
            ],
            minSize: sizes[0],
            maxSize: sizes[1],
            labels: {
                'role': 'airflow',
                'type': 'af-stateless',
                'lifecycle': 'spot'
            },
            taints: [
                {
                    effect: TaintEffect.NO_SCHEDULE,
                    key: 'dedicated',
                    value: 'airflow'
                }
            ],
            tags: {
                'Name': 'eks-airflow-nodegroup-pet',
                'cdk:asg:stack': `${this.pattern}-asg-${this.env_tag}`
            },
            launchTemplateSpec: {
                id: this.launchTemplate.launchTemplateId!
            }
        });
    };

    createAsgSts(type: string, sizes: Array<number>) {
        /**
         * ASG STS: Assign Airflow workers
         */
        const asgNodeGroupName = 'eks-airflow-nodegroup-sts';

        const asgStatefulSet = new Nodegroup(this, 'AirflowStsAsg', {
            nodegroupName: asgNodeGroupName,
            subnets: this.eks_cluster.vpc.selectSubnets({subnetType: ec2.SubnetType.PRIVATE}),
            cluster: this.eks_cluster,
            nodeRole: this.worker_role,
            instanceTypes: [new ec2.InstanceType(type)],
            capacityType: CapacityType.SPOT,
            minSize: sizes[0],
            maxSize: sizes[1],
            labels: {
                'role': 'airflow',
                'type': 'af-stateful',
                'lifecycle': 'spot'
            },
            taints: [
                {
                    effect: TaintEffect.NO_SCHEDULE,
                    key: 'dedicated',
                    value: 'airflow'
                }
            ],
            tags: {
                'Name': 'eks-airflow-nodegroup-sts',
                'cdk:asg:stack': `${this.pattern}-asg-${this.env_tag}`
            },
            launchTemplateSpec: {
                id: this.launchTemplate.launchTemplateId!
            }
        });
    };

    createAsgDb(type: string) {
        /**
         * ASG Db: Assign Airflow database and redis to this worker group
         */
        const asgNodeGroupName = 'eks-airflow-nodegroup-db';

        const asgStatefulSet = new Nodegroup(this, 'AirflowDbAsg', {
            nodegroupName: asgNodeGroupName,
            subnets: this.eks_cluster.vpc.selectSubnets({subnetType: ec2.SubnetType.PRIVATE}),
            cluster: this.eks_cluster,
            nodeRole: this.worker_role,
            instanceTypes: [new ec2.InstanceType(type)],
            capacityType: CapacityType.ON_DEMAND,
            minSize: 1,
            maxSize: 1,
            labels: {
                'role': 'airflow',
                'type': 'af-db',
                'lifecycle': 'on-demand'
            },
            taints: [
                {
                    effect: TaintEffect.NO_SCHEDULE,
                    key: 'dedicated',
                    value: 'airflow'
                }
            ],
            tags: {
                'Name': 'eks-airflow-nodegroup-db',
                'cdk:asg:stack': `${this.pattern}-asg-${this.env_tag}`
            },
            launchTemplateSpec: {
                id: this.launchTemplate.launchTemplateId!
            }
        });
    };
}