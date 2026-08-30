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
    name               = "cache"
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
    elasticache = {
      name               = "elasticache"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "runtime-jobs"
      configuration      = "region,tags,encryption_enabled,quota_units"
      rollback           = "disable-cache-and-preserve-ledger"
      security           = "private-subnets-encryption-and-auth-token"
      data               = "cache-only-no-business-source-of-truth"
      cost               = "redis-node-and-throughput-budget"
      local_fake         = "deterministic-redis-cache-plan"
    }
  }
}

output "service_catalog" {
  value = local.service_catalog
}
