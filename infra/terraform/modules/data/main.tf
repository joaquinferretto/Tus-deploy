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
    name               = "data"
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
    rds_aurora = {
      name               = "rds_aurora"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "data-platform"
      configuration      = "region,tags,encryption_enabled,retention_days,quota_units"
      rollback           = "verified-database-backup-and-last-schema"
      security           = "private-subnets-encryption-and-secret-store-reference"
      data               = "postgresql-source-of-truth"
      cost               = "rds-instance-and-storage-budget"
      local_fake         = "deterministic-relational-plan"
      source_of_truth    = "postgresql"
      duplicate_store    = false
    }
    mongo_decision_adapter = {
      name               = "mongo_decision_adapter"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "data-platform"
      configuration      = "region,tags,encryption_enabled,retention_days,quota_units"
      rollback           = "rebuild-owned-read-model-from-postgresql"
      security           = "private-network-and-secret-store-reference"
      data               = "owned-document-read-model-only"
      cost               = "atlas-or-documentdb-owner-approved-budget"
      local_fake         = "deterministic-document-adapter-plan"
      source_of_truth    = "postgresql"
      document_store_mode = "read-model-only"
      duplicate_store    = false
    }
  }
}

output "service_catalog" {
  value = local.service_catalog
}
