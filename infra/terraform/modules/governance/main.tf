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
    name               = "governance"
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
    budgets = {
      name               = "budgets"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "platform-governance"
      configuration      = "region,tags,quota_units"
      rollback           = "last-passing-budget-thresholds"
      security           = "budget-alert-recipient-policy"
      data               = "cost-and-usage-aggregates-only"
      cost               = "hard-spend-alert-and-owner-approval"
      local_fake         = "deterministic-budget-threshold-plan"
    }
    service_quotas = {
      name               = "service_quotas"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "platform-governance"
      configuration      = "region,tags,quota_units"
      rollback           = "last-approved-quota-profile"
      security           = "quota-change-audit"
      data               = "quota-metadata-only"
      cost               = "quota-growth-budget"
      local_fake         = "deterministic-service-quota-plan"
    }
    alerts = {
      name               = "alerts"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "platform-governance"
      configuration      = "region,tags,quota_units,retention_days"
      rollback           = "last-passing-alert-routing-and-thresholds"
      security           = "redacted-alert-reasons-and-owner-scoped-routing"
      data               = "budget-quota-security-and-health-state"
      cost               = "notification-and-alert-budget"
      local_fake         = "deterministic-governance-alert-plan"
    }
  }
}

output "service_catalog" {
  value = local.service_catalog
}
