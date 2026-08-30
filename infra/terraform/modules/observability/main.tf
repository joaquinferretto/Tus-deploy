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
    name               = "observability"
    enabled            = var.enabled
    region             = var.region
    tags               = var.tags
    encryption_enabled = var.encryption_enabled
    retention_days     = var.retention_days
    quota_units        = var.quota_units
    infrastructure_state = "contract-only-no-provisioning"
    evidence_schema       = "factory.operations.v1"
  }
}

locals {
  service_catalog = {
    cloudwatch_otel = {
      name               = "cloudwatch_otel"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "platform-observability"
      configuration      = "region,tags,encryption_enabled,retention_days,quota_units"
      rollback           = "last-passing-dashboard-and-alarm-config"
      security           = "redacted-telemetry-and-kms-encryption"
      data               = "correlation-metrics-logs-and-traces-with-retention"
      cost               = "metric-log-trace-ingest-budget"
      local_fake         = "deterministic-otel-cloudwatch-plan"
    }
    cloudwatch_logs = {
      name               = "cloudwatch_logs"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "platform-observability"
      configuration      = "region,tags,encryption_enabled,retention_days"
      rollback           = "last-passing-log-group-and-retention-config"
      security           = "redacted-structured-logs-and-kms-encryption"
      data               = "redacted-logs-with-correlation-context"
      cost               = "log-ingest-and-retention-budget"
      local_fake         = "deterministic-cloudwatch-log-plan"
    }
    cloudwatch_metrics = {
      name               = "cloudwatch_metrics"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "platform-observability"
      configuration      = "region,tags,retention_days,quota_units"
      rollback           = "last-passing-metric-dimension-config"
      security           = "tenant-safe-low-cardinality-metrics"
      data               = "aggregated-metrics-without-payloads"
      cost               = "metric-cardinality-budget"
      local_fake         = "deterministic-cloudwatch-metric-plan"
    }
    cloudwatch_alarms = {
      name               = "cloudwatch_alarms"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "platform-observability"
      configuration      = "region,tags,quota_units"
      rollback           = "last-passing-alarm-thresholds"
      security           = "owner-scoped-alert-routing"
      data               = "threshold-state-and-redacted-reason"
      cost               = "alarm-and-notification-budget"
      local_fake         = "deterministic-alert-threshold-plan"
    }
  }
}

output "service_catalog" {
  value = local.service_catalog
}
