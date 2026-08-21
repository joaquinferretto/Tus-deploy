locals {
  tags = merge({ profile = "render", environment = var.environment, managed_by = "terraform" }, var.tags)
}

module "governance" {
  source  = "../../modules/governance"
  enabled = true
  tags    = local.tags
}

output "profile" {
  value = {
    name              = "render"
    deployment        = "native-services-and-workers"
    production_docker = false
    dependencies      = ["neon-postgresql", "managed-mongodb", "redis", "b2"]
    tags              = local.tags
  }
}
