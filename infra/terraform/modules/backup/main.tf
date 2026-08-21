variable "enabled" { type = bool }
variable "tags" { type = map(string) }
output "capability" { value = { name = "backup", enabled = var.enabled, tags = var.tags } }
