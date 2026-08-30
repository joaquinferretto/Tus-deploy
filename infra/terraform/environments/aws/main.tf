locals {
  default_capabilities = {
    network       = false
    compute       = false
    data          = false
    cache         = false
    storage       = false
    edge          = false
    queue         = false
    observability = false
    security      = false
    backup        = false
    governance    = false
  }

  capabilities = merge(local.default_capabilities, var.enabled_capabilities)
  tags = merge(
    { profile = "aws-terraform", environment = var.environment, managed_by = "terraform" },
    var.tags
  )

  critical_service_catalog = merge(
    module.network.service_catalog,
    module.compute.service_catalog,
    module.data.service_catalog,
    module.cache.service_catalog,
    module.storage.service_catalog,
    module.edge.service_catalog,
    module.queue.service_catalog,
    module.observability.service_catalog,
    module.security.service_catalog,
    module.backup.service_catalog,
    module.governance.service_catalog
  )

  data_store_decision = {
    source_of_truth      = "postgresql"
    document_store_mode  = "read-model-only"
    decision_adapter     = "mongo_decision_adapter"
    duplicate_store      = false
    reconciliation       = "transactional-outbox-and-explicit-reconciliation"
  }

  deployment_flags = {
    api         = true
    web         = true
    workers     = true
    tusRoutes   = false
    providers   = false
    releaseJobs = false
    fleetJobs   = false
  }
  activation_flags = {
    mercadoPago          = false
    whatsapp              = false
    aws                   = false
    render                = false
    cloud                 = false
    legal                 = false
    tax                   = false
    kyc                   = false
    kyb                   = false
    postgresql            = false
    browser               = false
    device                = false
    posPilot              = false
    productionOperations  = false
  }
}

module "network" {
  source              = "../../modules/network"
  enabled             = local.capabilities.network
  region              = var.region
  tags                = local.tags
  encryption_enabled  = var.encryption_enabled
  retention_days      = var.retention_days
  quota_units         = var.quota_units
}

module "compute" {
  source              = "../../modules/compute"
  enabled             = local.capabilities.compute
  region              = var.region
  tags                = local.tags
  encryption_enabled  = var.encryption_enabled
  retention_days      = var.retention_days
  quota_units         = var.quota_units
}

module "data" {
  source              = "../../modules/data"
  enabled             = local.capabilities.data
  region              = var.region
  tags                = local.tags
  encryption_enabled  = var.encryption_enabled
  retention_days      = var.retention_days
  quota_units         = var.quota_units
}

module "cache" {
  source              = "../../modules/cache"
  enabled             = local.capabilities.cache
  region              = var.region
  tags                = local.tags
  encryption_enabled  = var.encryption_enabled
  retention_days      = var.retention_days
  quota_units         = var.quota_units
}

module "storage" {
  source              = "../../modules/storage"
  enabled             = local.capabilities.storage
  region              = var.region
  tags                = local.tags
  encryption_enabled  = var.encryption_enabled
  retention_days      = var.retention_days
  quota_units         = var.quota_units
}

module "edge" {
  source              = "../../modules/edge"
  enabled             = local.capabilities.edge
  region              = var.region
  tags                = local.tags
  encryption_enabled  = var.encryption_enabled
  retention_days      = var.retention_days
  quota_units         = var.quota_units
}

module "queue" {
  source              = "../../modules/queue"
  enabled             = local.capabilities.queue
  region              = var.region
  tags                = local.tags
  encryption_enabled  = var.encryption_enabled
  retention_days      = var.retention_days
  quota_units         = var.quota_units
}

module "observability" {
  source              = "../../modules/observability"
  enabled             = local.capabilities.observability
  region              = var.region
  tags                = local.tags
  encryption_enabled  = var.encryption_enabled
  retention_days      = var.retention_days
  quota_units         = var.quota_units
}

module "security" {
  source              = "../../modules/security"
  enabled             = local.capabilities.security
  region              = var.region
  tags                = local.tags
  encryption_enabled  = var.encryption_enabled
  retention_days      = var.retention_days
  quota_units         = var.quota_units
}

module "backup" {
  source              = "../../modules/backup"
  enabled             = local.capabilities.backup
  region              = var.region
  tags                = local.tags
  encryption_enabled  = var.encryption_enabled
  retention_days      = var.retention_days
  quota_units         = var.quota_units
}

module "governance" {
  source              = "../../modules/governance"
  enabled             = local.capabilities.governance
  region              = var.region
  tags                = local.tags
  encryption_enabled  = var.encryption_enabled
  retention_days      = var.retention_days
  quota_units         = var.quota_units
}

output "capabilities" {
  value = {
    network       = module.network.capability
    compute       = module.compute.capability
    data          = module.data.capability
    cache         = module.cache.capability
    storage       = module.storage.capability
    edge          = module.edge.capability
    queue         = module.queue.capability
    observability = module.observability.capability
    security      = module.security.capability
    backup        = module.backup.capability
    governance    = module.governance.capability
  }
}

output "profile" {
  value = {
    name                 = "aws-terraform"
    region               = var.region
    environment          = var.environment
    capability_flags     = local.capabilities
    encryption_enabled   = var.encryption_enabled
    retention_days       = var.retention_days
    quota_units          = var.quota_units
    tags                 = local.tags
    service_catalog_version = "aws-critical-catalog-v1"
    activation_policy    = "all-services-disabled-until-owner-approved"
    infrastructure_state = "contract-only-no-provisioning"
  }
}

output "critical_service_catalog" {
  value = local.critical_service_catalog
}

output "data_store_decision" {
  value = local.data_store_decision
}

output "deployment_flags" {
  value = local.deployment_flags
}

output "activation_flags" {
  value = local.activation_flags
}
