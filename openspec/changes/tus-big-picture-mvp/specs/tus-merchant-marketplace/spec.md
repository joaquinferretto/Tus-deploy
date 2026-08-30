# tus-merchant-marketplace Specification

## Purpose

Enable approved merchants to onboard and publish accurate products and core services, while customers discover and create context-separated commitments through bounded marketplace and merchant operations.

## Requirements

### Requirement: Merchant Onboarding and Publication

An organization MUST complete required profile, location, staff-role, cohort, and operating-policy data before publishing. The server MUST enforce publication eligibility and keep merchant administration separate from TUS platform-superadmin authority.

#### Scenario: Publishable product

- GIVEN an approved merchant has a valid location, price, availability, and product description
- WHEN an authorized merchant admin publishes the product
- THEN it becomes discoverable with tenant and audit attribution

#### Scenario: Incomplete or excluded merchant

- GIVEN required data is missing or the offer is outside Stage 1 scope
- WHEN publication is requested
- THEN the request is rejected and no public listing is created

### Requirement: Distinct Product and Service Models

The system MUST represent physical/digital products and appointments or duration/day/hour services as distinct listing and operational commitments. It MUST NOT use a universal lifecycle that permits product stock transitions to act as service-slot or labor transitions.

#### Scenario: Service availability

- GIVEN a service has configured duration, working hours, resource capacity, and timezone
- WHEN a customer requests an available slot
- THEN the system creates a service-specific hold or commitment and prevents an overlapping booking

#### Scenario: Product stock boundary

- GIVEN a product has insufficient available stock
- WHEN a customer attempts to commit the requested quantity
- THEN the product commitment is rejected without creating appointment or service state

### Requirement: Discovery and Server-Enforced Commercial Facts

Public discovery MUST return only published, tenant-authorized-to-publish listings with current availability, currency, price, location, and capability metadata. Checkout or booking MUST revalidate price, availability, tenant, and policy; stale client data MUST NOT create a commitment.

#### Scenario: Stale offer

- GIVEN a displayed price or availability version is no longer current
- WHEN the customer submits a commitment
- THEN the server rejects or refreshes the request and creates no commitment from stale facts

#### Scenario: Context-separated checkout

- GIVEN a customer selects one product and one service
- WHEN the customer continues to checkout
- THEN the system presents separate product and service commitments rather than a combined universal lifecycle

### Requirement: Scoped Merchant Operations

Merchant owners, admins, staff, and providers MUST see and mutate only the organizations, locations, offerings, schedules, customers, and commitments allowed by their role. Every sensitive operation MUST be auditable.

#### Scenario: Staff scope

- GIVEN staff member S is assigned to location L only
- WHEN S requests another location's schedule or edits its catalog
- THEN the request is denied and the attempted action is audited

#### Scenario: Deterministic discovery proof

- GIVEN a contract test uses a fake catalog transport
- WHEN it returns a listing
- THEN the result is labeled deterministic/test-only and is not production marketplace evidence
