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

variable "restore_drill_enabled" {
  type    = bool
  default = false
}

variable "dlq_replay_enabled" {
  type    = bool
  default = false
}

variable "retention_deletion_propagation" {
  type    = bool
  default = true
}

output "capability" {
  value = {
    name               = "backup"
    enabled            = var.enabled
    region             = var.region
    tags               = var.tags
    encryption_enabled = var.encryption_enabled
    retention_days     = var.retention_days
    quota_units        = var.quota_units
    restore_drill_enabled          = var.restore_drill_enabled
    dlq_replay_enabled             = var.dlq_replay_enabled
    retention_deletion_propagation = var.retention_deletion_propagation
  }
}

locals {
  service_catalog = {
    backup = {
      name               = "backup"
      enabled            = var.enabled
      profile_gate       = "aws-terraform"
      activation         = "disabled-until-approved"
      owner              = "data-recovery"
      configuration      = "region,tags,encryption_enabled,retention_days,quota_units"
      rollback           = "last-verified-restore-point"
      security           = "vault-lock-and-kms-encryption"
      data               = "verified-database-and-object-recovery-points"
      cost               = "backup-storage-and-restore-budget"
      local_fake           = "deterministic-backup-restore-plan"
      verification         = "verified-backup-then-restore-drill"
      recovery             = "postgres-ledger-and-dlq-replay-reconciliation"
      retention            = "tracked-deletion-propagation-and-legal-hold"
      evidence             = "recovery-drill-evidence-without-live-conformance"
      infrastructure_state = "contract-only-no-provisioning"
    }
  }
}

output "service_catalog" {
  value = local.service_catalog
}
