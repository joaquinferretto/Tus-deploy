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
