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
    name               = "security"
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
    iam_sts_kms = {
      name               = "iam_sts_kms"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "platform-security"
      configuration      = "region,tags,encryption_enabled,quota_units"
      rollback           = "last-passing-policy-and-key-version"
      security           = "least-privilege-sts-assumerole-and-kms"
      data               = "key-and-policy-metadata-only"
      cost               = "key-and-policy-budget"
      local_fake         = "deterministic-iam-kms-plan"
    }
    cloudtrail = {
      name               = "cloudtrail"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "platform-security"
      configuration      = "region,tags,encryption_enabled,retention_days"
      rollback           = "last-passing-trail-config"
      security           = "organization-audit-trail-and-kms"
      data               = "redacted-management-and-data-events"
      cost               = "event-and-storage-retention-budget"
      local_fake         = "deterministic-audit-trail-plan"
    }
    guardduty = {
      name               = "guardduty"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "platform-security"
      configuration      = "region,tags,encryption_enabled,quota_units"
      rollback           = "disable-detector-preserve-findings"
      security           = "threat-detection-and-finding-protection"
      data               = "security-findings-with-retention"
      cost               = "detector-and-finding-budget"
      local_fake         = "deterministic-security-finding-plan"
    }
    security_hub = {
      name               = "security_hub"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "platform-security"
      configuration      = "region,tags,encryption_enabled,quota_units"
      rollback           = "disable-hub-preserve-findings"
      security           = "centralized-control-findings"
      data               = "normalized-security-findings"
      cost               = "hub-and-finding-budget"
      local_fake         = "deterministic-security-hub-plan"
    }
    inspector = {
      name               = "inspector"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "platform-security"
      configuration      = "region,tags,encryption_enabled,quota_units"
      rollback           = "disable-scan-preserve-findings"
      security           = "image-and-runtime-vulnerability-findings"
      data               = "redacted-vulnerability-findings"
      cost               = "scan-and-finding-budget"
      local_fake         = "deterministic-inspector-plan"
    }
    security_findings = {
      name               = "security_findings"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "platform-security"
      configuration      = "region,tags,encryption_enabled,retention_days,quota_units"
      rollback           = "preserve-last-known-findings-and-disable-ingest"
      security           = "redacted-finding-evidence-and-least-privilege-readers"
      data               = "normalized-findings-without-secret-payloads"
      cost               = "finding-ingest-and-retention-budget"
      local_fake         = "deterministic-security-finding-plan"
    }
  }
}

output "service_catalog" {
  value = local.service_catalog
}
