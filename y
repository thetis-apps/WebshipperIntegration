version = 0.1
[y]
[y.deploy]
[y.deploy.parameters]
stack_name = "TestWebshipperIntegration"
s3_bucket = "aws-sam-cli-managed-default-samclisourcebucket-1q52gionhjeg3"
s3_prefix = "TestWebshipperIntegration"
region = "eu-west-1"
capabilities = "CAPABILITY_IAM"
parameter_overrides = "ContextId=\"550\" ClientId=\"ThetisClientId\" ClientSecret=\"ThetisClientSecret\" ApiKey=\"b495480a-181c-4608-ab12-d72977776395\" DevOpsEmail=\"lmp@thetis-apps.com\""