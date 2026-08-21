# Provider Adapters Specification

## Purpose

Keep external services behind neutral ports with deterministic local conformance and explicit activation gates.

## Requirements

### Requirement: Neutral provider ports and fakes

The system MUST provide implemented, configured ports/adapters and deterministic fakes for B2, PostgreSQL/Neon, MongoDB, Redis, SQS/DLQ, AWS capabilities, Groq LLM/STT/TTS, email/SES, Mercado Pago, WhatsApp, and notification channels; domain/application code MUST NOT import vendor SDKs. Rationale: reusable behavior must not depend on live accounts or provider-specific control flow.

#### Scenario: Local conformance
- GIVEN a provider-free Compose environment
- WHEN the same contract suite runs against fakes
- THEN success, timeout, retry, duplicate, signature, quota, and redaction semantics are deterministic

#### Scenario: Adapter outage
- GIVEN a configured external adapter timeout
- WHEN a request or job retries
- THEN bounded retry/circuit/DLQ policy applies, no secret appears in logs, and the source ledger remains authoritative

### Requirement: Secure Mercado Pago and WhatsApp V1 adapters

Mercado Pago and WhatsApp MUST be V1 neutral adapters with signed/validated webhooks, replay/idempotency protection, normalized events, fakes, reference scenarios, and reconciliation; business flows MUST remain outside the core. Rationale: the integrations are reusable infrastructure, not product domain logic.

#### Scenario: Valid webhook
- GIVEN a correctly signed provider event with a new idempotency key
- WHEN it is received
- THEN receipt metadata commits before processing, the normalized event follows its saga/outbox, and tenant authorization is enforced

#### Scenario: Forged or repeated webhook
- GIVEN an invalid signature or previously processed event
- WHEN the endpoint receives it
- THEN it rejects or returns the recorded outcome without a state change, and the security/audit evidence is retained

### Requirement: AWS service catalog and activation gates

AWS MUST define normative categories: core Terraform modules for VPC, ECS/Fargate/ECR, RDS, ElastiCache, S3, CloudFront, WAF, Route53/ACM, IAM/STS/KMS, SQS/DLQ, CloudWatch/OTel, CloudTrail, GuardDuty, Security Hub, Inspector, Backup, Budgets, and Service Quotas; implemented adapters for S3, SQS/DLQ, EventBridge, Lambda, telemetry, IAM/STS/KMS, and security/backup/budget controls; gated adapters for Bedrock, Guardrails, Transcribe, Polly, Textract, Rekognition, Translate, and SES; and deferred OpenSearch, Location, Athena, Glue, and Kinesis pending concrete use case, owner, cost boundary, and fake/fixture. Every entry MUST have configuration, ownership, evidence, and an explicit profile gate. Rationale: catalog breadth must not become empty or universal activation.

#### Scenario: Gated activation
- GIVEN a complete adapter with fake evidence, approved region/quotas/owner, credentials, and authorized live smoke
- WHEN a profile activates it
- THEN the gate records evidence and scoped configuration before traffic is admitted

#### Scenario: Gate denied or rollback
- GIVEN absent credits, credentials, availability, budget, or evidence
- WHEN activation is requested
- THEN it remains disabled with a concrete disposition; rollback disables it without deleting neutral contracts or replayable work
