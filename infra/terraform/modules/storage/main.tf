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
    name               = "storage"
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
    s3 = {
      name               = "s3"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "assets-platform"
      configuration      = "region,tags,encryption_enabled,retention_days"
      rollback           = "versioned-object-reconciliation"
      security           = "bucket-policy-kms-and-private-access"
      data               = "transient-staging-only-b2-remains-durable-source"
      cost               = "storage-request-and-egress-budget"
      local_fake         = "deterministic-object-storage-plan"
    }
  }
}

output "service_catalog" {
  value = local.service_catalog
}
