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
    name               = "network"
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
    vpc = {
      name               = "vpc"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "platform-network"
      configuration      = "region,tags,encryption_enabled"
      rollback           = "versioned-terraform-module"
      security           = "private-subnets-and-deny-by-default-security-groups"
      data               = "network-metadata-only"
      cost               = "nat-and-egress-budget"
      local_fake         = "deterministic-network-plan"
    }
    subnets = {
      name               = "subnets"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "platform-network"
      configuration      = "region,tags,encryption_enabled"
      rollback           = "versioned-terraform-module"
      security           = "private-workload-subnets"
      data               = "network-metadata-only"
      cost               = "subnet-and-egress-budget"
      local_fake         = "deterministic-network-plan"
    }
    security_groups = {
      name               = "security_groups"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "platform-network"
      configuration      = "region,tags,encryption_enabled"
      rollback           = "versioned-terraform-module"
      security           = "least-privilege-ingress-egress"
      data               = "network-metadata-only"
      cost               = "security-group-budget"
      local_fake         = "deterministic-network-plan"
    }
  }
}

output "service_catalog" {
  value = local.service_catalog
}
