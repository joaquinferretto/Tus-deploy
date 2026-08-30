# TUS Merchant Marketplace Specification

## Purpose

Enable approved Argentina-first merchants to onboard, publish products and services, and let authenticated customers discover and initiate separate commitments.

## Requirements

### Requirement: Cohort-bounded merchant onboarding

The system MUST support beauty/personal care excluding regulated healthcare and repairs/trades as launch cohorts, while keeping cohort policy configurable and rejecting unsupported or regulated offerings.

#### Scenario: Complete approved onboarding

- GIVEN an authenticated owner in an approved cohort
- WHEN required business, location, policy, and staff data is complete
- THEN the merchant can proceed to listing publication

#### Scenario: Incomplete or excluded onboarding

- GIVEN missing required data or an excluded regulated capability
- WHEN publication is requested
- THEN publication is denied with no discoverable listing

### Requirement: Truthful listing publication

Product and service listings MUST expose current tenant-owned price, availability, locale, and policy facts. Product stock and service capacity/slot rules MUST remain separate.

#### Scenario: Publish and discover

- GIVEN a complete listing with valid current facts
- WHEN it is published and a customer searches its location/category
- THEN the customer sees only the entitled published listing and its current facts

#### Scenario: Stale or unavailable facts

- GIVEN a changed price, exhausted stock, or overlapping service slot
- WHEN discovery or checkout evaluates the listing
- THEN the stale or unavailable option is rejected or refreshed before commitment

### Requirement: Separate product and service commitments

The MVP MUST create product and service commitments through distinct bounded lifecycles. Combined-cart behavior MUST NOT be implied or enabled by shared payment or customer references.

#### Scenario: Separate checkout intents

- GIVEN a customer selects one product and one service
- WHEN checkout is initiated
- THEN two independently addressable commitment intents are created with their own policy references

### Requirement: Scoped merchant operations

Merchant owners, admins, staff, and providers MUST see and mutate only the organizations, locations, listings, schedules, customers, and commitments allowed by their authenticated role and assignment. Sensitive mutations MUST be auditable.

#### Scenario: Location-scoped staff

- GIVEN staff member S is assigned to location L only
- WHEN S requests another location's schedule or edits its catalog
- THEN the request is denied and the attempt is audited

#### Scenario: Authorized merchant update

- GIVEN an owner or admin has permission for a tenant-owned listing
- WHEN the listing is updated
- THEN the mutation is persisted with actor, tenant, and correlation attribution
