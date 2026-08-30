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
    name               = "edge"
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
    cloudfront = {
      name               = "cloudfront"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "platform-edge"
      configuration      = "region,tags,encryption_enabled,retention_days"
      rollback           = "last-passing-distribution-config"
      security           = "origin-access-control-and-tls"
      data               = "cached-responses-follow-retention-policy"
      cost               = "distribution-and-egress-budget"
      local_fake         = "deterministic-edge-plan"
    }
    waf = {
      name               = "waf"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "platform-security"
      configuration      = "region,tags,encryption_enabled,quota_units"
      rollback           = "last-passing-web-acl-rules"
      security           = "managed-rules-and-rate-limits"
      data               = "redacted-request-metadata-only"
      cost               = "web-acl-and-request-budget"
      local_fake         = "deterministic-waf-decision-plan"
    }
    route53_acm = {
      name               = "route53_acm"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "platform-edge"
      configuration      = "region,tags,encryption_enabled,retention_days"
      rollback           = "last-passing-dns-and-certificate-config"
      security           = "dnssec-and-managed-tls"
      data               = "dns-and-certificate-metadata-only"
      cost               = "hosted-zone-and-certificate-budget"
      local_fake         = "deterministic-dns-tls-plan"
    }
  }
}

output "service_catalog" {
  value = local.service_catalog
}
