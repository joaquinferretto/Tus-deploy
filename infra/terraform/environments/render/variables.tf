variable "environment" {
  type    = string
  default = "local-plan"
}

variable "tags" {
  type    = map(string)
  default = {}
}
