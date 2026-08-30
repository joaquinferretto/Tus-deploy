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
    name               = "compute"
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
    ecs_fargate = {
      name               = "ecs_fargate"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "platform-runtime"
      configuration      = "region,tags,encryption_enabled,quota_units"
      rollback           = "last-passing-task-definition"
      security           = "private-tasks-iam-and-encrypted-logs"
      data               = "runtime-state-remains-in-authoritative-stores"
      cost               = "fargate-task-budget-and-quota"
      local_fake         = "deterministic-task-definition-plan"
    }
    ecr = {
      name               = "ecr"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "platform-runtime"
      configuration      = "region,tags,encryption_enabled,retention_days"
      rollback           = "last-passing-image-digest"
      security           = "immutable-digest-and-scan-policy"
      data               = "image-metadata-only"
      cost               = "registry-retention-budget"
      local_fake         = "deterministic-image-digest-plan"
    }
  }
}

output "service_catalog" {
  value = local.service_catalog
}
