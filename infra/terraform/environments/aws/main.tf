locals {
  tags = merge({ profile = "aws", environment = var.environment, managed_by = "terraform" }, var.tags)
  capabilities = {
    network       = try(var.enabled_capabilities.network, false)
    compute       = try(var.enabled_capabilities.compute, false)
    data          = try(var.enabled_capabilities.data, false)
    cache         = try(var.enabled_capabilities.cache, false)
    storage       = try(var.enabled_capabilities.storage, false)
    edge          = try(var.enabled_capabilities.edge, false)
    queue         = try(var.enabled_capabilities.queue, false)
    observability = try(var.enabled_capabilities.observability, false)
    security      = try(var.enabled_capabilities.security, false)
    backup        = try(var.enabled_capabilities.backup, false)
    governance    = try(var.enabled_capabilities.governance, false)
  }
}

module "network" {
  source  = "../../modules/network"
  enabled = local.capabilities.network
  tags    = local.tags
}

module "compute" {
  source  = "../../modules/compute"
  enabled = local.capabilities.compute
  tags    = local.tags
}

module "data" {
  source  = "../../modules/data"
  enabled = local.capabilities.data
  tags    = local.tags
}

module "cache" {
  source  = "../../modules/cache"
  enabled = local.capabilities.cache
  tags    = local.tags
}

module "storage" {
  source  = "../../modules/storage"
  enabled = local.capabilities.storage
  tags    = local.tags
}

module "edge" {
  source  = "../../modules/edge"
  enabled = local.capabilities.edge
  tags    = local.tags
}

module "queue" {
  source  = "../../modules/queue"
  enabled = local.capabilities.queue
  tags    = local.tags
}

module "observability" {
  source  = "../../modules/observability"
  enabled = local.capabilities.observability
  tags    = local.tags
}

module "security" {
  source  = "../../modules/security"
  enabled = local.capabilities.security
  tags    = local.tags
}

module "backup" {
  source  = "../../modules/backup"
  enabled = local.capabilities.backup
  tags    = local.tags
}

module "governance" {
  source  = "../../modules/governance"
  enabled = local.capabilities.governance
  tags    = local.tags
}

output "profile" { value = { name = "aws", region = var.region, capabilities = local.capabilities, tags = local.tags } }
