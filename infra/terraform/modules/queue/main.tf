variable "enabled" { type = bool }
variable "region" { type = string }
variable "tags" { type = map(string) }
variable "encryption_enabled" { type = bool }
variable "retention_days" {
  type = number
  validation {
    condition     = var.retention_days >= 0
    error_message = "retention_days must be non-negative."
  }
}
variable "quota_units" {
  type = number
  validation {
    condition     = var.quota_units >= 0
    error_message = "quota_units must be non-negative."
  }
}

output "capability" {
  value = {
    name               = "queue"
    enabled            = var.enabled
    region             = var.region
    tags               = var.tags
    encryption_enabled = var.encryption_enabled
    retention_days     = var.retention_days
    quota_units        = var.quota_units
  }
}

locals {
  service_catalog = {
    sqs_dlq = {
      name               = "sqs_dlq"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "runtime-jobs"
      configuration      = "region,tags,encryption_enabled,retention_days,quota_units"
      rollback           = "stop-intake-preserve-ledger-replay-dlq"
      security           = "kms-encryption-and-least-privilege-queue-policy"
      data               = "delivery-envelope-only-ledger-is-authoritative"
      cost               = "queue-request-and-dlq-retention-budget"
      local_fake         = "deterministic-queue-and-dlq-plan"
    }
    eventbridge = {
      name               = "eventbridge"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "runtime-events"
      configuration      = "region,tags,encryption_enabled,quota_units"
      rollback           = "disable-rule-preserve-outbox"
      security           = "tenant-scoped-event-bus-policy"
      data               = "versioned-event-envelope-only"
      cost               = "event-and-rule-budget"
      local_fake         = "deterministic-event-routing-plan"
    }
    lambda = {
      name               = "lambda"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "runtime-events"
      configuration      = "region,tags,encryption_enabled,quota_units"
      rollback           = "last-passing-function-version"
      security           = "execution-role-and-private-configuration"
      data               = "stateless-handler-payload-only"
      cost               = "invocation-and-duration-budget"
      local_fake         = "deterministic-lambda-invocation-plan"
    }
  }
}

output "service_catalog" {
  value = local.service_catalog
}
