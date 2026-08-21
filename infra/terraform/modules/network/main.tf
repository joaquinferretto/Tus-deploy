variable "enabled" { type = bool }
variable "tags" { type = map(string) }
output "capability" { value = { name = "network", enabled = var.enabled, tags = var.tags } }
