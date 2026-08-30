variable "region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  type    = string
  default = "local-plan"
}

variable "enabled_capabilities" {
  type    = map(bool)
  default = {}
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "encryption_enabled" {
  type    = bool
  default = true
}

variable "retention_days" {
  type    = number
  default = 30

  validation {
    condition     = var.retention_days >= 0
    error_message = "retention_days must be non-negative."
  }
}

variable "quota_units" {
  type    = number
  default = 100

  validation {
    condition     = var.quota_units >= 0
    error_message = "quota_units must be non-negative."
  }
}
