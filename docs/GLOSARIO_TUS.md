# Glosario normativo de TUS

Este documento es la fuente normativa para nombrar el dominio propio de TUS en TypeScript, Prisma, PostgreSQL, API, contracts, Web, tests y documentación.

El documento define el objetivo de normalización. No modifica por sí mismo código, contratos, rutas reales, bases de datos ni migraciones.

## Principios generales

- Todo concepto que pertenezca al negocio o al funcionamiento propio de TUS se expresa en español.
- Los identificadores técnicos se escriben sin tildes ni caracteres especiales.
- Los nombres visibles para usuarios pueden llevar tildes y mayúsculas normales del español.
- Los nombres de protocolos, lenguajes, frameworks, herramientas y proveedores externos conservan su forma original.
- Los payloads, estados y propiedades exigidos por terceros conservan exactamente el formato externo.
- Un término inglés que permanezca por compatibilidad debe estar identificado como temporal, histórico, externo o técnico.
- No se deben crear sinónimos para el mismo concepto dentro de una misma capa.
- Antes de traducir un término se debe confirmar su responsabilidad real en TUS; no se traducen palabras por similitud superficial.
- La presencia de un término en este glosario no autoriza a crear una entidad, tabla, endpoint, clase o funcionalidad. El glosario únicamente normaliza nombres de conceptos existentes o respaldados explícitamente por la documentación funcional de TUS. La existencia real de cada concepto debe comprobarse durante el inventario previo a la implementación.

## Convenciones de nombres

### TypeScript

| Elemento | Convención | Ejemplo |
| --- | --- | --- |
| Tipos, interfaces y clases | `PascalCase` sin tildes | `SolicitudServicio` |
| Propiedades, variables y funciones | `camelCase` sin tildes | `solicitudServicioId` |
| Schemas | `camelCase` terminado en `Schema` | `solicitudServicioSchema` |
| Validadores | verbo `validar` más concepto | `validarSolicitudServicio` |
| Repositorios | `Repositorio` más concepto plural | `RepositorioSolicitudesServicio` |
| Errores propios | concepto más causa | `SolicitudServicioNoEncontrada` |
| Constantes | `UPPER_SNAKE_CASE` cuando corresponda | `ESTADO_PENDIENTE` |

Ejemplos recomendados:

```ts
type SolicitudServicio = ...
interface Prestador { ... }
class RepositorioPresupuestos { ... }
function obtenerSolicitudServicio() { ... }
function crearPresupuesto() { ... }
const prestadorId = ...
```

### PostgreSQL

Los nombres físicos finales del dominio TUS deberán estar en español, en `snake_case`, sin tildes:

| Elemento | Ejemplo |
| --- | --- |
| Tabla | `solicitudes_servicio` |
| Columna | `prestador_id` |
| Marca temporal | `creado_en`, `actualizado_en` |
| Índice | `solicitudes_servicio_prestador_id_idx` |
| Restricción | `solicitudes_servicio_tenant_id_fkey` |

`tenant` permanece como excepción técnica normativa también en persistencia.

Esta convención es un objetivo futuro. Esta fase no modifica PostgreSQL, Prisma ni migraciones.

## Excepciones técnicas

No traducir las primitivas, APIs o herramientas siguientes:

`import`, `export`, `class`, `interface`, `type`, `async`, `await`, `Promise`, `Map`, `Set`, `fetch`, `JSON`, `Date`, `Error`, `HTTP`, `GET`, `POST`, `PATCH`, `UUID`, `URL`, `Prisma`, `PostgreSQL`, `Redis`, `Docker`, `React`, `Next.js`, `Express`, `Expo`, `package.json` y `tsconfig.json`.

No traducir nombres exigidos por herramientas externas, como `DATABASE_URL` y `NODE_ENV`.

Conservar también `OAuth`, `OIDC`, `PKCE`, `MFA`, `RAG`, `POS`, `SDK`, `API`, `URL`, `UUID`, `SHA-256`, `scrypt`, `Webhook`, `Embedding` y `Prompt` cuando formen parte de una convención técnica o de una integración.

## Identidad y seguridad

| Concepto canónico | Identificador recomendado | Anterior | Definición simple | No usar como equivalente general |
| --- | --- | --- | --- | --- |
| Usuario | `Usuario` | `User` | Persona que utiliza TUS o participa en una operación. | Persona, cliente |
| Cuenta | `Cuenta` | `Account` | Registro de acceso y credenciales de una identidad. | Usuario |
| Credencial de contraseña | `CredencialContrasena` | `PasswordCredential` | Información segura utilizada para comprobar una contraseña. | Clave, password |
| Token de verificación | `TokenVerificacion` | `VerificationToken` | Token de un solo uso para verificar una operación o identidad. | Código genérico |
| Token de recuperación | `TokenRecuperacion` | `RecoveryToken` | Token utilizado para recuperar el acceso. | Token reset |
| Dispositivo | `Dispositivo` | `Device` | Dispositivo reconocido o asociado a una cuenta. | Equipo, terminal |
| Sesión | `Sesion` | `Session` | Periodo autenticado durante el cual una identidad puede operar. | Login |
| Familia de tokens de renovación | `FamiliaTokenRenovacion` | `RefreshTokenFamily` | Conjunto relacionado de tokens de renovación que permite detectar reutilización o compromiso. | Familia refresh |
| Identidad externa | `IdentidadExterna` | `ExternalIdentity` | Identidad proveniente de un proveedor externo de autenticación. | Cuenta externa |
| Vinculación de cuenta | `VinculacionCuenta` | `AccountLinking` | Asociación segura entre una cuenta TUS y una identidad externa. | Enlace de cuenta |
| Desafío MFA | `DesafioMFA` | `MfaChallenge` | Comprobación adicional requerida por la autenticación multifactor. | Reto MFA |
| Evento de seguridad | `EventoSeguridad` | `SecurityEvent` | Registro de una acción relevante para la seguridad. | Log de seguridad |

## Tenant y aislamiento

### Tenant

**Identificador recomendado:** `Tenant`

**Anterior:** `Tenant`

**Definición:** Unidad técnica de aislamiento de datos dentro de TUS. Determina a qué ámbito pertenecen datos, usuarios, permisos y operaciones. Dos tenants diferentes no deben acceder a los datos del otro. Un tenant puede corresponder a distintos tipos de unidades operativas de TUS y no implica necesariamente una empresa u organización.

**Reglas de uso:**

- Mantener `Tenant` y `tenantId` en identificadores propios.
- Se permiten identificadores mixtos como `ContextoTenant`, `RolTenant`, `RecursoTenant`, `verificarAccesoTenant` y `obtenerDatosTenant`.
- En la interfaz de usuario no mostrar “Tenant”; utilizar el concepto funcional que corresponda.
- Documentar inicialmente como “Tenant, unidad técnica de aislamiento” cuando sea necesario explicar el concepto.

**No usar como equivalente:** `Organización`, `Organizacion`, `Inquilino`, `Empresa`, `Cuenta`.

| Concepto canónico | Identificador recomendado | Anterior | Definición | No usar |
| --- | --- | --- | --- | --- |
| Contexto de Tenant | `ContextoTenant` | `TenantContext` | Información del tenant y del actor que delimita una operación. | Contexto de organización |
| Rol de Tenant | `RolTenant` | `TenantRole` | Permiso agrupado dentro del límite de un tenant. | Rol de organización |
| Recurso de Tenant | `RecursoTenant` | `TenantResource` | Recurso cuyo acceso está limitado por tenant. | Recurso de organización |
| Membresía | `Membresia` | `Membership` | Relación de un usuario con un tenant o espacio de trabajo. | Afiliación |
| Invitación | `Invitacion` | `Invitation` | Propuesta para incorporar una identidad a un ámbito. | Invitación de organización |
| Alcance de recurso | `AlcanceRecurso` | `ResourceScope` | Límite concreto que determina qué recurso puede utilizar un actor. | Scope de recurso |

### Espacio de trabajo

| Concepto canónico | Identificador recomendado | Anterior | Definición simple | Regla |
| --- | --- | --- | --- | --- |
| Espacio de trabajo | `EspacioTrabajo` | `Workspace` | Espacio lógico de trabajo utilizado para agrupar actividad o recursos cuando ese concepto exista realmente en TUS. | Durante el inventario posterior se verificará si sigue siendo una entidad activa o si es legacy. |

`workspaceId` se normaliza como `espacioTrabajoId` cuando el concepto sea confirmado. Espacio de trabajo no es equivalente a Tenant: el Tenant define el aislamiento técnico de datos, mientras que un espacio de trabajo agrupa actividad o recursos dentro del modelo funcional que corresponda.

## Usuarios y autorización

| Concepto canónico | Identificador recomendado | Anterior | Definición simple | No usar como equivalente general |
| --- | --- | --- | --- | --- |
| Prestador | `Prestador` | `Provider` | Persona o unidad que ofrece y realiza servicios mediante TUS. Es el término genérico del sistema. | Proveedor, profesional, técnico |
| Prestador candidato | `PrestadorCandidato` | `Provider Candidate` | Prestador que está siendo evaluado para una solicitud o servicio. | Candidato proveedor |
| Solicitud a prestador | `SolicitudPrestador` | `Provider Request` | Solicitud dirigida a un prestador para obtener respuesta o intervención. | Pedido al proveedor |
| Cliente | `Cliente` | `Customer` | Persona que busca, solicita, reserva o recibe un producto o servicio. | Consumidor, usuario |
| Comerciante | `Comerciante` | `Merchant` | Actor que administra una oferta comercial dentro de TUS. | Vendedor, proveedor |
| Personal | `Personal` | `Staff` | Personas autorizadas a operar en nombre de un comerciante o unidad operativa. | Empleados, equipo |
| Rol | `Rol` | `Role` | Conjunto de permisos asignables a un actor. | Perfil |
| Permiso | `Permiso` | `Permission` | Autorización concreta para realizar una acción. | Capacidad |
| Decisión de autorización | `DecisionAutorizacion` | `AuthorizationDecision` | Resultado de comprobar si una operación está permitida. | Decisión de acceso |

## Catálogo y publicaciones

| Concepto canónico | Identificador recomendado | Anterior | Definición simple | No usar como equivalente general |
| --- | --- | --- | --- | --- |
| Producto | `Producto` | `Product` | Bien que puede ofrecerse o venderse mediante TUS. | Artículo, ítem |
| Servicio | `Servicio` | `Service` | Actividad que un prestador realiza para un cliente. | Trabajo, prestación |
| Publicación | `Publicacion` | `Listing` | Oferta visible que describe un producto o servicio disponible. | Listado, anuncio |
| Oferta | `Oferta` | `Offer` | Propuesta comercial disponible bajo determinadas condiciones. | Publicación, descuento |
| Catálogo | `Catalogo` | `Catalog` | Conjunto organizado de productos y servicios. | Inventario |
| Inventario | `Inventario` | `Inventory` | Productos y cantidades disponibles para operar. | Catálogo |
| Disponibilidad | `Disponibilidad` | `Availability` | Indicación de cuándo o bajo qué condiciones puede prestarse o venderse algo. | Existencia |
| Zona de servicio | `ZonaServicio` | `Service Area` | Área geográfica donde un prestador puede prestar un servicio. | Área del proveedor |

### Agenda, disponibilidad y reserva de publicaciones

| Concepto canónico | Identificador recomendado | Anterior o contrato | Definición simple | Regla |
| --- | --- | --- | --- | --- |
| Calendario | `Calendario` | `Calendar` | Agenda que contiene reglas, excepciones y reservas de disponibilidad. | Es una entidad de persistencia; no equivale por sí sola a una publicación. |
| Agenda principal | `AgendaPrincipal` | `Primary Calendar` | Única agenda activa resuelta para un prestador dentro de un tenant. | Se obtiene por `(tenantId, prestadorId)`; no se elige arbitrariamente por `calendarId`. |
| Franja | `Franja` | `Slot` | Intervalo posible de inicio y fin generado por una agenda y una publicación. | Su identidad vigente es `calendarId:listingId:start`. |
| Modalidad de reserva | `ModalidadReserva` | `bookingMode` | Regla que determina la duración efectiva de una reserva de servicio. | Los valores públicos vigentes son `fixed_shift` y `variable_duration`. |
| Turno fijo | `TurnoFijo` | `fixed_shift` | Modalidad que exige `durationMinutes` positivo. | Se conserva el valor del contrato externo. |
| Duración variable | `DuracionVariable` | `variable_duration` | Modalidad que exige `estimatedDurationMinutes` positivo. | Se conserva el valor del contrato externo. |
| Modalidad de precio | `ModalidadPrecio` | `priceMode` | Regla que determina si una publicación puede reservarse automáticamente. | Los valores públicos vigentes son `fixed` y `requires_budget`. |
| Presupuesto requerido | `PresupuestoRequerido` | `requires_budget` | Estado comercial que impide slots y reserva automática hasta contar con presupuesto. | El backend responde `BUDGET_REQUIRED`. |
| Estado de disponibilidad | `EstadoDisponibilidad` | `availabilityStatus` | Indica si una publicación de servicio tiene agenda activa. | `configured` debe incluir `calendarId`; `not_configured` no debe incluirlo. |
| Identificador de publicación | `listingId` | `listingId` | Identificador de contrato de una `Publicacion`. | Se mantiene por compatibilidad contractual; no reemplazarlo por `serviceId`. |

`serviceId` es un identificador legacy del calendario. No es la identidad canónica de una publicación de servicio y
no debe usarse para crear nuevas relaciones o reservas.

## Mercado de servicios

**Identificador recomendado:** `MercadoServicios`

**Anterior:** `Marketplace`

**Definición:** Parte de TUS donde clientes encuentran, comparan y acceden a publicaciones y servicios ofrecidos por prestadores.

**Reglas de uso:**

- El término funcional final es `Mercado de servicios`.
- El identificador técnico recomendado es `MercadoServicios`.
- `Marketplace` sólo puede aparecer temporalmente durante compatibilidad, en documentación histórica o al identificar un nombre legado antes de migrarlo.
- No usar `Mercado` sin especificar el contexto.

**No usar:** `Marketplace` como nombre final del dominio, `Mercado` solo, `Tienda`.

## Solicitudes de servicio

| Concepto canónico | Identificador recomendado | Anterior | Definición simple | No usar como equivalente general |
| --- | --- | --- | --- | --- |
| Solicitud de servicio | `SolicitudServicio` | `Service Request` | Pedido de un cliente para obtener un servicio de un prestador. | Requerimiento, ticket |
| Línea de solicitud de servicio | `LineaSolicitudServicio` | `Service Request Line` | Parte individual de una solicitud que describe un servicio o condición. | Ítem de solicitud |
| Solicitud de información | `SolicitudInformacion` | `Information Request` | Pedido de datos necesario para continuar una operación. | Query |
| Descubrimiento | `Descubrimiento` | `Discovery` | Búsqueda y selección de publicaciones o servicios disponibles. | Search |

## Prestadores

| Concepto canónico | Identificador recomendado | Anterior | Definición simple | No usar como equivalente general |
| --- | --- | --- | --- | --- |
| Prestador | `Prestador` | `Provider` | Persona o unidad que ofrece y realiza servicios mediante TUS. | Proveedor, profesional, técnico |
| Prestador candidato | `PrestadorCandidato` | `Provider Candidate` | Prestador que puede ser seleccionado para una solicitud. | Profesional candidato |
| Área de servicio | `ZonaServicio` | `Service Area` | Zona donde el prestador puede trabajar. | Territorio proveedor |
| Reputación | `Reputacion` | `Reputation` | Información acumulada sobre la confiabilidad o calidad de un prestador. | Ranking, puntuación |
| Inspección | `Inspeccion` | `Inspection` | Revisión de una condición, servicio o resultado. | Auditoría, control |

## Trabajos

| Concepto canónico | Identificador recomendado | Anterior | Definición simple | No usar como equivalente general |
| --- | --- | --- | --- | --- |
| Trabajo | `Trabajo` | `Job` | Trabajo realizado por un prestador para un cliente. | Tarea, empleo |
| Asignación de rescate | `AsignacionRescate` | `Rescue Assignment` | Asignación de un trabajo destinado a resolver o recuperar una operación afectada. | Reasignación |
| Cumplimiento | `Cumplimiento` | `Fulfillment` | Resultado de completar una obligación, entrega o servicio. | Finalización genérica |
| Resultado de trabajo | `ResultadoTrabajo` | `Job Outcome` | Resultado documentado de la ejecución de un trabajo. | Salida, output |

## Presupuestos

| Concepto canónico | Identificador recomendado | Anterior | Definición simple | No usar como equivalente general |
| --- | --- | --- | --- | --- |
| Presupuesto | `Presupuesto` | `Quote` | Propuesta de precio y condiciones para un producto o servicio. | Cotización, quote |
| Línea de presupuesto | `LineaPresupuesto` | `Quote Line` | Concepto individual incluido en un presupuesto. | Ítem cotizado |
| Presupuesto aceptado | `PresupuestoAceptado` | `Accepted Quote` | Presupuesto que el cliente aceptó y puede originar una operación. | Venta confirmada |

## Evidencias

| Concepto canónico | Identificador recomendado | Anterior | Definición simple | No usar como equivalente general |
| --- | --- | --- | --- | --- |
| Evidencia | `Evidencia` | `Evidence` | Información que demuestra o respalda que un hecho ocurrió. | Prueba genérica, comprobante |
| Comprobante | `Comprobante` | `Proof` | Documento o registro entregable que acredita una operación. | Evidencia en todos los casos |
| Prueba | `Prueba` | `Proof` | Elemento usado para verificar algo cuando ese es su sentido específico. | Comprobante |
| Evidencia de cumplimiento | `EvidenciaCumplimiento` | `Completion Evidence` | Evidencia de que una obligación o servicio fue completado. | Prueba de finalización |
| Evidencia de habilitación | `EvidenciaHabilitacion` | `Readiness Evidence` | Evidencia utilizada para decidir si una capacidad puede operar. | Evidencia de preparación |

`Proof` no tiene una traducción automática. Se usa `Evidencia` cuando demuestra un hecho, `Comprobante` cuando es un documento o registro entregable y `Prueba` sólo cuando ese sea el sentido funcional real.

## Reservas y compromisos

| Concepto canónico | Identificador recomendado | Anterior | Definición simple | No usar como equivalente general |
| --- | --- | --- | --- | --- |
| Reserva | `Reserva` | `Booking` | Bloqueo o asignación de una franja, recurso o servicio para un cliente. | Booking |
| Compromiso | `Compromiso` | `Commitment` | Obligación registrada entre actores de TUS respecto de una operación. | Promesa, reserva |
| Carrito | `Carrito` | `Cart` | Conjunto temporal de productos o servicios seleccionados antes de confirmar. | Cesta |
| Línea de carrito | `LineaCarrito` | `Cart Line` | Producto o servicio individual dentro de un carrito. | Ítem de carrito |
| Confirmación de compra | `ConfirmacionCompra` | `Checkout` | Paso o resultado de finalizar una compra. | Checkout |
| Inasistencia | `Inasistencia` | `No-show` | Falta del cliente o prestador a una reserva confirmada. | Ausencia |

`Checkout` se traducirá según su responsabilidad real. Si representa finalizar una compra, se usará `ConfirmacionCompra`. Si representa un proceso común a productos y servicios, se definirá un nombre más general antes de implementarlo.

## Pagos y comisiones

| Concepto canónico | Identificador recomendado | Anterior | Definición simple | No usar como equivalente general |
| --- | --- | --- | --- | --- |
| Pago | `Pago` | `Payment` | Transferencia o cobro registrado por una operación. | Abono |
| Intención de pago | `IntencionPago` | `Payment Intent` | Registro de que se quiere realizar un pago antes de completarlo. | Pago confirmado |
| Comisión | `Comision` | `Commission` | Importe o regla que TUS aplica por una operación. | Tarifa en todos los contextos |
| Instantánea de comisión | `InstantaneaComision` | `Commission Snapshot` | Copia inmutable de la comisión calculada para una operación. | Foto de comisión |
| Reintegro | `Reintegro` | `Refund` | Devolución total o parcial de un importe cobrado. | Devolución genérica |
| Contracargo | `Contracargo` | `Chargeback` | Reversión de un pago iniciada mediante el circuito de pago. | Reintegro |
| Conciliación | `Conciliacion` | `Reconciliation` | Comparación entre operaciones registradas y movimientos externos. | Cuadre |
| Movimiento contable | `MovimientoContable` | `Ledger Entry` | Registro individual dentro de un libro contable. | Entrada contable |

## Facturación y liquidaciones

| Concepto canónico | Identificador recomendado | Anterior | Definición simple | No usar como equivalente general |
| --- | --- | --- | --- | --- |
| Liquidación | `Liquidacion` | `Settlement` | Cálculo y cierre de importes que deben distribuirse entre actores. | Pago |
| Factura | `Factura` | `Invoice` | Documento que registra una venta o prestación con finalidad fiscal o comercial. | Recibo |
| Línea de factura | `LineaFactura` | `Invoice Line` | Concepto individual incluido en una factura. | Ítem fiscal |
| Nota de crédito | `NotaCredito` | `Credit Note` | Documento que reduce o corrige el importe de una factura. | Reintegro |
| Suscripción | `Suscripcion` | `Subscription` | Acuerdo periódico de acceso o cobro. | Plan |
| Perfil fiscal | `PerfilFiscal` | `Tax Profile` | Datos fiscales aplicables a una persona o unidad operativa. | Perfil tributario |
| Cuenta de facturación | `CuentaFacturacion` | `Billing Account` | Cuenta utilizada para agrupar y gestionar facturación. | Cuenta de pago |
| Gestión de mora | `GestionMora` | `Dunning` | Proceso de seguimiento de importes vencidos. | Cobranza genérica |

## Entrega y punto de venta

| Concepto canónico | Identificador recomendado | Anterior | Definición simple | No usar como equivalente general |
| --- | --- | --- | --- | --- |
| Zona de entrega | `ZonaEntrega` | `Delivery Zone` | Área donde se realizan entregas. | Área logística |
| Turno de entrega | `TurnoEntrega` | `Delivery Shift` | Periodo asignado para ejecutar entregas. | Jornada |
| Tarea de entrega | `TareaEntrega` | `Delivery Task` | Trabajo concreto de entrega que debe ejecutarse. | Pedido |
| Comprobante de entrega | `ComprobanteEntrega` | `Delivery Proof` | Registro que acredita una entrega. | Evidencia en todos los contextos |
| Incidente de entrega | `IncidenteEntrega` | `Delivery Incident` | Problema ocurrido durante una entrega. | Reclamo |
| Retiro | `Retiro` | `Pickup` | Obtención de un producto o pedido en un punto definido. | Recolección |
| En tránsito | `EnTransito` | `Transit` | Estado de una entrega que está desplazándose hacia su destino. | En viaje |
| Punto de venta | `PuntoVenta` | `POS` | Lugar o capacidad donde se registra una operación comercial. | Caja, POS como nombre de dominio |
| Operación de punto de venta | `OperacionPuntoVenta` | `POS Operation` | Operación registrada en el punto de venta. | Transacción POS |
| Comprobante de punto de venta | `ComprobantePuntoVenta` | `POS Receipt` | Comprobante emitido por una operación de venta. | Ticket |
| Conflicto de punto de venta | `ConflictoPuntoVenta` | `POS Conflict` | Inconsistencia que requiere revisión en una operación del punto de venta. | Error de caja |

`POS` se conserva en integraciones, protocolos, dispositivos y nombres exigidos externamente. En el dominio propio se recomienda `PuntoVenta`.

## Soporte, reclamos y disputas

| Concepto canónico | Identificador recomendado | Anterior | Definición simple | No usar como equivalente general |
| --- | --- | --- | --- | --- |
| Caso de soporte | `CasoSoporte` | `Support Case` | Registro de una necesidad de asistencia o resolución. | Ticket |
| Línea de tiempo de soporte | `LineaTiempoSoporte` | `Support Timeline` | Secuencia de hechos y acciones de un caso de soporte. | Historial genérico |
| Reclamo | `Reclamo` | `Claim` | Manifestación formal de un problema o incumplimiento. | Queja, disputa |
| Disputa | `Disputa` | `Dispute` | Conflicto entre partes que requiere evaluación o resolución. | Reclamo |
| Inspección | `Inspeccion` | `Inspection` | Revisión de hechos, condiciones o evidencias relacionados con un caso. | Auditoría |
| Compensación | `Compensacion` | `Compensation` | Medida económica u operativa para reparar un incumplimiento. | Reintegro |
| Derivación a soporte | `DerivacionSoporte` | `Support Handoff` | Transferencia controlada de una operación o caso al soporte. | Escalamiento |

## WhatsApp y comunicaciones

| Concepto canónico | Identificador recomendado | Anterior | Definición simple | Regla |
| --- | --- | --- | --- | --- |
| Acción de WhatsApp | `AccionWhatsApp` | `WhatsApp Action` | Acción de comunicación que TUS registra o solicita mediante WhatsApp. | `WhatsApp` conserva su nombre externo |
| Confirmación de WhatsApp | `ConfirmacionWhatsApp` | `WhatsApp Confirmation` | Confirmación recibida o registrada para una acción de WhatsApp. | No traducir payloads externos |
| Consentimiento de WhatsApp | `ConsentimientoWhatsApp` | `WhatsApp Consent` | Autorización para recibir comunicaciones por WhatsApp. | Permiso de mensajería |
| Mensaje de WhatsApp | `MensajeWhatsApp` | `WhatsApp Message` | Mensaje gestionado por TUS en el canal WhatsApp. | Mensaje externo genérico |
| Plantilla | `Plantilla` | `Template` | Modelo reutilizable de contenido para una comunicación. | Formato |

Los nombres, estados, campos y payloads exigidos por la API de WhatsApp se mantienen exactamente como los define el proveedor.

## Habilitación operativa

### Habilitación

**Identificador recomendado:** `Habilitacion`

**Anterior:** `Readiness`

**Definición:** Decisión de si una capacidad, integración o flujo puede operar bajo las condiciones actuales.

No traducir automáticamente `Readiness` como `Preparacion`. Usar `Preparacion` sólo cuando el contexto describa literalmente un estado preparatorio.

| Concepto canónico | Identificador recomendado | Anterior | Definición simple |
| --- | --- | --- | --- |
| Decisión de habilitación | `DecisionHabilitacion` | `ReadinessDecision` | Resultado que indica si una capacidad puede operar. |
| Requisito de habilitación | `RequisitoHabilitacion` | `ReadinessGate` | Condición que debe cumplirse para habilitar una capacidad. |
| Evidencia de habilitación | `EvidenciaHabilitacion` | `ReadinessEvidence` | Información que respalda la decisión de habilitación. |
| Capacidad | `Capacidad` | `Capability` | Función que puede estar habilitada, limitada o deshabilitada. |
| Resultado de habilitación | `ResultadoHabilitacion` | `Disposition` | Resultado funcional de evaluar una capacidad. |

`Disposition` no debe traducirse palabra por palabra. Si representa otro resultado distinto de una evaluación de habilitación, se documentará con el significado específico antes de renombrarlo.

## Auditoría y plataforma

| Concepto canónico | Identificador recomendado | Anterior | Definición simple | No usar como equivalente general |
| --- | --- | --- | --- | --- |
| Auditoría | `Auditoria` | `Audit` | Revisión o registro que permite conocer qué ocurrió y quién actuó. | Control |
| Evento de auditoría | `EventoAuditoria` | `Audit Event` | Registro individual de una acción relevante. | Log |
| Referencia de auditoría | `ReferenciaAuditoria` | `Audit Reference` | Identificador o vínculo a la evidencia de una auditoría. | Número de control |
| Idempotencia | `Idempotencia` | `Idempotency` | Propiedad por la que repetir una solicitud segura no duplica su efecto. | Reintento |
| Registro de idempotencia | `RegistroIdempotencia` | `Idempotency Record` | Registro que permite reconocer una solicitud ya procesada. | Cache de solicitud |
| Evento de bandeja de salida | `EventoBandejaSalida` | `Outbox Event` | Evento pendiente de publicación o entrega a otro componente. | Evento saliente |
| Registro de búsqueda | `RegistroBusqueda` | `Search Record` | Registro utilizado para conservar información de una búsqueda. | Resultado de búsqueda |
| Instantánea de agregado | `InstantaneaAgregado` | `Aggregate Snapshot` | Copia del estado de un agregado en un momento determinado. | Foto del agregado |
| Job técnico | `Job` | `Job` | Ejecución técnica de infraestructura, un worker, una cola o un proceso background. | Trabajo |

El `Job` técnico no es equivalente a `Trabajo`. No usar `Trabajo` para ambos conceptos.
| Mensaje fallido | `MensajeFallido` | `Dead Letter` | Mensaje que no pudo procesarse y requiere revisión o reproceso. | Papelera |

## Persistencia

Los nombres de dominio de Prisma y PostgreSQL deben converger al español en el estado final.

Ejemplos objetivo:

| Actual | Objetivo Prisma | Objetivo PostgreSQL |
| --- | --- | --- |
| `ServiceRequest` | `SolicitudServicio` | `solicitudes_servicio` |
| `service_requests` | `SolicitudServicio` | `solicitudes_servicio` |
| `provider_id` | `prestadorId` | `prestador_id` |
| `customer_id` | `clienteId` | `cliente_id` |
| `created_at` | `creadoEn` | `creado_en` |
| `updated_at` | `actualizadoEn` | `actualizado_en` |
| `Quote` | `Presupuesto` | `presupuestos` |
| `Claim` | `Reclamo` | `reclamos` |

El renombrado futuro debe realizarse mediante migraciones seguras. No se deben resetear bases, recrear tablas si puede utilizarse `RENAME`, perder datos ni editar migraciones históricas ya aplicadas. Deben preservarse PK, FK, índices, uniques y constraints.

## API propia de TUS

Estos son nombres objetivo para rutas propias de TUS:

| Ruta anterior | Ruta objetivo |
| --- | --- |
| `/service-requests` | `/solicitudes-servicio` |
| `/quotes` | `/presupuestos` |
| `/claims` | `/reclamos` |
| `/providers` | `/prestadores` |
| `/customers` | `/clientes` |
| `/commitments` | `/compromisos` |
| `/bookings` | `/reservas` |
| `/payments` | `/pagos` |
| `/settlements` | `/liquidaciones` |
| `/support-cases` | `/casos-soporte` |
| `/delivery-tasks` | `/tareas-entrega` |
| `/marketplace` | `/mercado-servicios` |

Estas rutas son objetivo normativo y no constituyen cambios sobre las rutas reales actuales.

Los aliases legacy sólo podrán mantenerse durante una transición explícita, con consumidor identificado, fecha de retiro y prueba de que ya no son necesarios.

No traducir rutas pertenecientes a integraciones externas.

## Estados propios

Para estados controlados por TUS:

| Valor anterior | Valor objetivo |
| --- | --- |
| `pending` | `pendiente` |
| `confirmed` | `confirmado` |
| `cancelled` | `cancelado` |
| `fulfilled` | `cumplido` |
| `frozen` | `congelado` |
| `released` | `liberado` |
| `compensated` | `compensado` |
| `rejected` | `rechazado` |
| `expired` | `expirado` |

Estos cambios sólo se aplicarán en el futuro a contratos, estados y eventos propios de TUS. Los valores recibidos o enviados a terceros deben conservar exactamente el valor exigido por la integración.

## Integraciones externas

No traducir nombres ni contratos definidos por:

- Mercado Pago.
- WhatsApp.
- AWS.
- OAuth y OIDC.
- Proveedores externos de pagos, mensajería, identidad o infraestructura.
- HTTP, JSON, UUID, URL, `DATABASE_URL`, `NODE_ENV` y demás convenciones técnicas.

La traducción puede aplicarse en el adaptador interno de TUS, pero la frontera externa debe conservar nombres, estados, propiedades y payloads originales.

## Términos pendientes de definición

Estos términos requieren confirmar su responsabilidad funcional en el código y la documentación antes de fijar un identificador definitivo:

| Término | Motivo de la espera | Acción requerida |
| --- | --- | --- |
| `Service Capture` | No está confirmado si registra la prestación, la toma de un servicio, el inicio de ejecución o una captura comercial. | Revisar flujo, persistencia y consumidor antes de elegir entre `RegistroServicio`, `InicioServicio`, `CapturaServicio` u otro nombre. |
| `Checkout` | Puede representar confirmación de compra, creación de compromiso o un proceso común a productos y servicios. | Determinar su responsabilidad real antes de fijar `ConfirmacionCompra` u otro nombre general. |
| `Disposition` | Su significado depende de si expresa resultado de habilitación u otra clasificación operativa. | Confirmar el flujo que produce el valor antes de usar `ResultadoHabilitacion`. |
| `Proof` | Puede ser evidencia, comprobante o prueba según el flujo. | Elegir el nombre por contexto, no globalmente. |
| `Payload` | No es un concepto de dominio único. | Usar `datos`, `contenido` o el nombre semántico del objeto en contratos propios. |
| `Marketplace` | Debe desaparecer como nombre final, pero puede existir en compatibilidad o histórico. | Identificar consumidores y fecha de retiro. |
| `Tenant` en interfaz | El concepto técnico debe permanecer, pero no debe mostrarse al usuario. | Elegir el concepto funcional visible por pantalla. |
| `Settlement` frente a `Payment` | Ambos pueden aparecer asociados a dinero, pero liquidación no es pago. | Mantener `Liquidacion` para el cierre/distribución y `Pago` para el movimiento de cobro. |
| `Booking` frente a `Commitment` | Reserva y compromiso pueden coexistir con responsabilidades distintas. | Confirmar límites de cada agregado antes de renombrar contratos o estados. |

## Fuera del alcance de este glosario

Este documento no autoriza todavía:

- renombrar TypeScript;
- modificar Prisma;
- crear o aplicar migraciones;
- cambiar PostgreSQL;
- modificar API, contracts, Web, Mobile o tests;
- cambiar nombres de paquetes;
- eliminar `@factory`, `alqui` u otros nombres legacy;
- cambiar rutas reales;
- traducir contratos de terceros;
- hacer commit.
