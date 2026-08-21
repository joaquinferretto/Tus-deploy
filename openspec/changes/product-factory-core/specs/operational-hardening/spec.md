# Operational Hardening Specification

## Purpose

Define truthful deployment, cloud governance, secret handling, recovery, and evidence gates for Render-native and AWS Terraform profiles.

## Requirements

### Requirement: Render and AWS Terraform production profiles

The system MUST support Render-native API/web services and Python workers with Neon PostgreSQL, managed MongoDB, Redis, and B2; and an AWS Terraform profile with the approved VPC/ECS/Fargate/ECR/RDS-or-approved relational, Mongo decision adapter, ElastiCache, S3, CloudFront, WAF, Route53/ACM, queues, observability, security, backup, budget, and quota boundaries. Terraform MUST be the sole IaC source; CDK MUST NOT be parallel. Rationale: both launch paths are approved and must be reproducible.

#### Scenario: Profile smoke
- GIVEN approved configuration and provider-free or authorized conformance dependencies
- WHEN each production profile smoke runs
- THEN lifecycle, contracts, worker delivery, data ownership, telemetry, rollback, and reference behavior pass independently

#### Scenario: IaC drift or failed deploy
- GIVEN Terraform plan drift or a failed profile rollout
- WHEN the gate evaluates it
- THEN deployment stops or rolls back to the last passing state, identifies the drift, and never silently creates duplicate data sources

### Requirement: Secret non-disclosure and rotation

`.env` files MUST remain local-only, ignored, untracked, unread into artifacts, and absent from commits, logs, prompts, specs, and generated examples; `.env.example` MUST contain fictitious values only; pre-commit and CI secret scanning MUST block tracked secrets; real values MUST live only in Render/AWS secret stores. Render-to-AWS bootstrap credentials MUST be minimum-scope STS AssumeRole only, with temporary scoped credentials. Rationale: Gitignore alone does not protect tracked or exposed secrets.

#### Scenario: Tracked-secret block
- GIVEN a staged file containing a credential, token, certificate, or provider key
- WHEN pre-commit or CI scanning runs
- THEN the change is blocked, the value is not printed, and remediation requires removal and rotation

#### Scenario: Secret incident
- GIVEN evidence that a secret was exposed
- WHEN the incident procedure starts
- THEN the secret is immediately revoked/rotated, affected access is scoped, logs/artifacts are reviewed without reproducing it, and the incident is recorded

### Requirement: Operations, recovery, and readiness truth

The system MUST expose OTel/CloudWatch-compatible telemetry, CloudTrail, security findings, backups, budgets, quotas, retention/deletion evidence, runbooks, and reversible profile flags; MUST distinguish local, authorized live, and unavailable-provider evidence; and MUST NOT claim production readiness absent verified evidence for every applicable gate. Rationale: operational claims must be evidence-backed.

#### Scenario: Evidence-backed readiness
- GIVEN all applicable tests, clean-environment portability, profile smoke, security scans, recovery, cost, and owner-authorized live gates
- WHEN readiness is reviewed
- THEN the claim identifies evidence, profile, date, scope, and remaining deferred services

#### Scenario: Missing evidence
- GIVEN any failed, expired, unauthorized, or unavailable live gate
- WHEN readiness is reviewed
- THEN the result is not production-ready, while deterministic local/fake verification may continue
