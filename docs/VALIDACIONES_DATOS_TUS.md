# Validaciones de datos de TUS

Referencia de qué se valida, dónde y con qué reglas. La API es la autoridad: la Web valida para
ayudar a la persona, pero una llamada directa con datos inválidos se rechaza igual.

Estado: auditoría del 2026-10-05 (rama `audit/validaciones-formularios`). "corregido" = tenía un
hueco real y se arregló en esta auditoría; "ok" = revisado, ya validaba; "pendiente" = ver §6.

## 1. Reglas generales

| Dato | Regla | Dónde vive |
| --- | --- | --- |
| Nombre y apellido | Letras Unicode con tildes y ñ, palabras separadas por UN espacio, apóstrofo o guion, punto opcional tras una palabra; 2 a 60 caracteres; sin dígitos ni símbolos. El apóstrofo tipográfico del teclado móvil vale como apóstrofo. Se recortan y colapsan espacios. | `normalizarNombrePersona` (`packages/contracts/src/tus-perfil.ts`), compartida por API y Web |
| Nombre visible de cuenta | Una línea, 1 a 120 caracteres, sin caracteres de control ni ocultos. Admite dígitos (nombre comercial). | `normalizeDisplayName` (`apps/api/src/auth-security/domain/validation.ts`) |
| Documento | Tipo de una lista cerrada (DNI, LC, LE, PASAPORTE). DNI/LC/LE: solo dígitos, 7 u 8 (6 a 8 en LC/LE), sin cero inicial. Pasaporte: 6 a 12 letras o dígitos. | `normalizarDocumento` (contracts) |
| Email | Recorte, minúsculas, formato, hasta 320 caracteres. | `normalizeEmail` / `validateEmail` |
| Teléfono | Normalizador canónico único (E.164). No hay otra implementación. | `normalizarTelefono` (contracts) |
| Importes | Enteros, nunca negativos, decimales, NaN ni Infinity. Agenda y alojamientos: pesos enteros hasta 100.000.000. Trabajos: unidades menores como texto de dígitos, hasta 13 dígitos. | `monto` (`apps/api/src/tus/validacion/entrada.ts`), `validateMinorAmount` |
| Moneda | Lista cerrada: `ARS`. | `MONEDAS`, `LIMITES_TRABAJO.monedas` |
| Fechas | Instante ISO 8601 con zona (`Z` o `±HH:MM`); inicio anterior a fin; rangos acotados. | `instante`, lectores de cada formulario |
| Texto | Recorte, colapso de espacios, NFC, largo en caracteres (no en unidades UTF-16), sin caracteres de control ni de reordenamiento. No se altera Unicode legítimo (tildes, emoji). | `texto` / `textoOpcional` |
| Booleanos | Solo `true` / `false` de JSON. `"false"`, `0` o `"no"` se rechazan. | `booleano` |
| Enumeraciones | Listas cerradas; un texto fuera de la lista se rechaza. | `enumerado` |
| Identificadores | `[A-Za-z0-9._:-]{1,120}`. Cuenta, tenant, administrador y prestador salen de la sesión, nunca del cuerpo. | `identificador` |
| Coordenadas | Números finitos, latitud ±90 y longitud ±180; el prestador decide si su punto exacto se publica. | `coordenadasValidas`, `leerAlojamiento` |
| Imágenes | Archivo real: se decide por los bytes (JPG/PNG/WEBP), con tope de tamaño. Dirección: solo `https`. | `foto.ts`, `urlHttps` |
| Campos desconocidos | Formularios cerrados: se rechazan con el nombre del campo. | `camposDesconocidos` |

Las funciones de `validacion/entrada.ts` reciben `unknown` y devuelven el valor normalizado o
`INVALIDO`. No convierten ni lanzan: una entrada mala nunca termina en un error 500.

## 2. Matriz por dominio

| Campo / dominio | Frontend | Backend | Normalización | Restricciones | Estado |
| --- | --- | --- | --- | --- | --- |
| Registro: nombre y apellido | regla compartida, error por campo | `normalizeDisplayName` | recorte, colapso | 1 a 120, sin control | corregido |
| Registro: email, contraseña | formato y largo | `validateEmail`, `validatePassword` | email en minúsculas | contraseña 12 a 256 | corregido (la API nombra el campo) |
| Registro: teléfono | normalizador canónico | idem | E.164 | único por cuenta | ok |
| Edición propia de cuenta | — | formulario cerrado (`displayName`) | idem registro | campos de privilegio: 403; otros: 400 | corregido |
| Login, recuperación | formato | servicio de auth | — | límite de intentos | ok |
| Perfil personal e identidad | misma función que la API | `validarPerfilPersonal`, `validarIdentidadPersonal` | nombres, documento, altura, CP | formulario cerrado | corregido (regla de nombre) |
| Documento | idem | idem | dígitos / mayúsculas | único (índice en BD) | ok |
| Residencia y dirección | idem | idem | — | calle 2 a 120, altura o S/N, CP argentino | ok |
| Teléfono y verificación | cliente de teléfono | `auth-security/phone` | E.164 | conflictos 409 | ok |
| Perfil público de prestador | formulario | `validarPerfil` | recorte | oficios y zonas de catálogo, radio 1 a 100, sin datos de contacto | ok |
| Ubicación del prestador | mapa | `guardarMiUbicacion` | 6 decimales | coordenadas válidas | ok |
| Foto de perfil | — | `foto.ts` | re-codificada | bytes reales, 2 MB | ok |
| Publicaciones (listings) | formulario | `validateListingInput` | — | nombre 120, descripción 2000, precio mayor a 0 y hasta 100.000.000, moneda ISO | corregido |
| Agenda: horarios semanales | formulario | `guardarDisponibilidadSemanal` | — | campos cerrados | ok |
| Agenda: turno manual | validación previa, `inputMode` | `leerTurnoEscrito` + servicio | teléfono E.164, email | precio entero, duración 5 a 1440, fechas con zona | corregido |
| Agenda: bloqueo | validación previa | `leerBloqueo` | recorte | fin posterior, hasta un año | corregido |
| Agenda: configuración de servicio | — | `leerConfiguracionServicio` + servicio | — | modalidad `local/domicilio/mixto`, descanso 0 a 240 | corregido |
| Agenda: tarifas | — | `leerTarifas` + servicio | recorte | hasta 20, nombre 80 | corregido |
| Agenda: estado de un turno | botones | `leerCambioDeEstado` + transiciones | — | estados permitidos por rol | corregido |
| Solicitud de turno (cliente) | formulario | `turnos-http` + servicio | — | campos cerrados; cliente = sesión | ok |
| Turnos Admin (general, forzar, precio, interruptores) | formulario | lectores + servicio | idem turno manual | motivo 5 a 300; admin = sesión | corregido |
| Solicitudes de trabajo | formulario | `validarNuevaSolicitud` | recorte | título y descripción acotados, sin datos de contacto | ok |
| Postulaciones | formulario | `validarMensajePostulacion` | recorte | largo, sin datos de contacto | ok |
| Presupuestos | validación previa | `createBudget` | líneas solo con sus campos | moneda ARS, 50 líneas, 13 dígitos, totales que cierran | corregido |
| Diagnóstico y evidencia de trabajo | formulario | `createDiagnosis`, `recordEvidence` | — | textos y objetos acotados; evidencia no futura | corregido |
| Mensajes de trabajo | formulario | `ServicioMensajesTrabajo` | recorte | largo, idempotencia | ok |
| Calificaciones | formulario | `calificar` | recorte | entero 1 a 5, una por trabajo | ok |
| Pagos y cobros | sin campos editables | verificador de pagos | — | montos del backend | ok |
| Alojamientos: reserva | formulario | `leerReserva` + servicio | email, teléfono E.164 | fechas en orden, 1 a 100 personas | corregido |
| Alojamientos: gestión (alta, unidad, tarifa, imagen, bloqueo) | formulario | lectores de `alojamientos-entrada.ts` | recorte | listas cerradas, precio entero ARS, imagen https | corregido |
| Admin: usuarios, identidad, teléfono | formulario con errores por campo | `admin/http.ts` + servicios | idem perfil | acciones de lista cerrada; actor = sesión | ok |
| Admin: catálogo, trabajos, pagos | formulario | servicios de cada dominio | — | permisos de administración | ok |
| Asistente Web y WhatsApp | — | orquestador y herramientas | texto acotado | escribe en dominio solo por los mismos servicios | ok |

## 3. Seguridad de contratos

- La cuenta, el tenant, el prestador y el administrador salen siempre de la sesión.
- Un campo que no es del formulario se rechaza (no se ignora) en los formularios auditados.
- Roles, permisos, verificaciones (`emailVerifiedAt`, `phoneVerifiedAt`, `verified`) y estados
  internos no se aceptan desde el cuerpo.
- Entrada inválida: 422 en perfil y Admin, 400 en agenda, trabajos y alojamientos (convención
  previa de cada módulo, sin cambios). Conflictos de unicidad o de estado: 409.

## 4. Validaciones que dependen de la base

| Regla | Garantía en PostgreSQL |
| --- | --- |
| Email único | índice único en `email` y `normalizedEmail` |
| Teléfono único | índice único en `phoneNumber` |
| Documento único | índice único por tipo y número (carrera probada en `tus-admin-identidad-postgres`) |
| Turnos y reservas sin solapamiento | restricciones de exclusión y bloqueo de agenda |
| Slug de alojamiento único | `uq_alojamientos_slug` |
| Rangos, precios, modalidades y días de alojamientos | restricciones `ck_*` |
| Un hecho activo por tipo, un resumen por versión | índices únicos de memoria |

No hizo falta ninguna migración nueva en esta auditoría.

## 5. Excepciones intencionales

- El nombre visible de una cuenta admite dígitos y un solo carácter: también es el nombre comercial
  de un prestador creado por la administración.
- Reserva y calificación de alojamientos toleran un `clienteId` en el cuerpo sin leerlo (clientes
  anteriores lo envían); el cliente es siempre la sesión.
- Los mensajes de error de agenda y alojamientos llegan en castellano desde la API junto con el
  campo (`fields`); la Web de agenda los muestra tal cual.

## 6. Pendientes

- **`createdAt` informado por el cliente** en las mutaciones de trabajos (diagnóstico, presupuesto,
  evidencia): la API lo acepta como parte del contrato de idempotencia y los tests lo usan con
  fechas fijas. Permite fechar una operación en el pasado. Acotarlo exige cambiar ese contrato.
- **Formularios Web de alojamientos y de presupuestos**: validan lo básico; los de alojamientos no
  muestran todavía el campo que la API devuelve en `fields`.
- **Módulos heredados sin pantalla en la Web de TUS** (POS, entregas, finanzas de plataforma,
  plantillas de WhatsApp): tienen rutas activas y no se auditaron campo por campo.
- **Smoke de navegador** de los formularios corregidos: no se corrió en esta auditoría.
