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
  tags = merge(
    { profile = "render-native", environment = var.environment, managed_by = "terraform" },
    var.tags
  )

  managed_boundaries = {
    postgresql = {
      provider        = "neon"
      owner           = "Data Platform"
      configuration   = "render.secret-store.database-url"
      rollback        = "last-passing-schema-and-verified-backup"
      fake_mode       = "disabled"
      activation_gate = "endpoint + secret reference + backup + quota + authorized smoke"
    }
    mongodb = {
      provider        = "managed-mongodb"
      owner           = "Document Data"
      configuration   = "render.secret-store.mongodb-uri"
      rollback        = "restore-or-rebuild-projections-with-reconciliation"
      fake_mode       = "fake"
      activation_gate = "owner + network + retention + backup + authorized smoke"
    }
    redis = {
      provider        = "render-managed-redis"
      owner           = "Runtime Jobs"
      configuration   = "render.secret-store.redis-url"
      rollback        = "disable-consumers-and-replay-postgresql-ledger"
      fake_mode       = "fake"
      activation_gate = "retry + quota + secret reference + authorized smoke"
    }
    "object-storage" = {
      provider        = "b2"
      owner           = "Assets"
      configuration   = "render.secret-store.object-storage-ref"
      rollback        = "revert-adapter-and-reconcile-versioned-objects"
      fake_mode       = "fake"
      activation_gate = "policy + encryption + lifecycle + authorized smoke"
    }
    queues = {
      provider        = "redis"
      owner           = "Runtime Jobs"
      configuration   = "render.managed-queue-ref"
      rollback        = "stop-intake-and-replay-ledger-outbox-dlq"
      fake_mode       = "fake"
      activation_gate = "queue policy + retry + secret reference + quota + authorized smoke"
    }
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
    name                 = "render-native"
    environment          = var.environment
    region               = var.region
    capability_flags     = local.capabilities
    encryption_enabled   = var.encryption_enabled
    retention_days       = var.retention_days
    quota_units          = var.quota_units
    tags                 = local.tags
    production_docker    = false
    infrastructure_state = "contract-only-no-provisioning"
    deployment_shape     = "native-api-web-python-workers"
  }
}

output "managed_boundaries" {
  value = local.managed_boundaries
}

output "profile_parity" {
  value = {
    profile                 = "render-native"
    counterpart             = "aws-terraform"
    required_boundaries     = sort(keys(local.managed_boundaries))
    shared_contracts        = true
    shared_ownership        = true
    shared_rollback         = true
    production_docker       = false
    duplicate_store         = false
    infrastructure_authority = "render-native-service-model"
    evidence_class          = "cloud-plan-validation"
    authorized_smoke_gate   = "separate-and-explicit"
    unavailable_disposition = "unavailable-deferred"
    live_conformance        = false
  }
}

output "deployment_flags" {
  value = local.deployment_flags
}

output "activation_flags" {
  value = local.activation_flags
}
