# Contamination and Boundary Map

The core must remain product-neutral. Existing copied material is recorded as
input evidence, not as an allowed dependency.

| Source / vocabulary | Classification | Core action | Isolated boundary | Evidence gate |
|---|---|---|---|---|
| `apps/api/backendFiles` | mixed copied provider and vertical material | do not import from core; selectively extract later | provider/reference slice | import scan |
| Alqui identifiers in mobile/config | product contamination | replace with profile-neutral names in assigned slices | none in core | vocabulary scan |
| Travelers SQL | vertical schema | do not use as core persistence model | reference fixture only if approved | schema scan |
| DocPhone/medical schemas | vertical behavior | excluded from core contracts | isolated reference only | contract scan |
| companion/Tilo logic | vertical behavior | excluded from core packages | isolated reference only | import scan |
| Google/Vertex defaults | excluded provider | no imports or config defaults | none | provider scan |
| Bedrock Agents/Flows | competing workflow authority | forbidden; LangGraph remains sole authority | none | architecture test |
| Prisma/Mongo/SQL/vendor SDKs | infrastructure detail | adapters only; domain/application use ports | adapter packages | dependency-boundary test |
| `.env` and real credentials | secret material | never read into artifacts, logs, prompts, or commits | Render/AWS secret store | security scan |

Neutral modules may use generic terms such as tenant, workspace, asset, job,
capability, provider, policy, and resource. A reference scenario cannot be
imported by packages or base applications.
