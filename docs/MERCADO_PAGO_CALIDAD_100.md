# Mercado Pago — calidad de integración (objetivo 100/100)

> Estado al 2026-10-10. Rama `feat/experiencia-operativa-tus`. Nada de esto está desplegado.
> No se hizo ningún pago real, ninguna vinculación OAuth real ni ninguna medición: la medición
> necesita un **payment ID de producción** y la herramienta del panel de Mercado Pago.

## Cómo mide Mercado Pago (fuente oficial)

Fuente: [Cómo medir la calidad de la integración](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/how-tos/integration-quality) (consultada el 2026-10-10).

- La medición se hace con el **payment ID de un pago hecho con credenciales de producción**, de forma automática (mensual) o manual desde *Tus integraciones → Detalles de aplicación → Calidad de integración → Iniciar medición / Medir de nuevo*.
- Puntaje mínimo exigido: **73**. Recomendado: **100**.
- Evalúa cinco aspectos: experiencia de compra, conciliación financiera, aprobación de pagos, escalabilidad (APIs y bibliotecas oficiales actualizadas) y seguridad.
- Tipos de acción: **obligatorias** (por ejemplo, activar las notificaciones Webhooks y enviar una referencia externa), **recomendadas** (suman puntaje; por ejemplo, enviar la información del comprador) y **buenas prácticas** (no afectan el puntaje).
- **La página oficial no publica la lista campo por campo.** La lista exacta con el puntaje de cada acción solo aparece en el resultado de la medición del panel (y en la herramienta `quality_checklist` del MCP Server de Mercado Pago, que requiere credenciales). Por eso este documento no afirma que el puntaje vaya a ser 100: deja preparado lo que TUS controla y marca qué hay que mirar en la primera medición.

Los nombres de los campos de la preferencia se contrastaron con la referencia oficial de [Crear preferencia](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/create-preference/post): `items[].id`, `title`, `description`, `picture_url`, `category_id`, `quantity`, `currency_id`, `unit_price`; `payer.name`, `surname`, `email`, `phone`, `identification`, `address`; `back_urls`, `notification_url`, `auto_return`, `external_reference`, `expires`, `expiration_date_from/to`. Esa página **no** documenta como parámetro de entrada `statement_descriptor`, `binary_mode` ni la lista de valores de `category_id` (ver "Pendiente manual").

## Flujo de negocio (no cambia)

Cliente → paga a la cuenta de Mercado Pago de TUS → TUS retiene → el trabajo se confirma y cierra → TUS libera al saldo interno del prestador → el prestador pide el retiro → lo recibe en su Mercado Pago vinculado. Mercado Pago vinculado **solo** se exige para retirar. No se usa Split como flujo productivo.

## Checklist

Evidencia: `apps/api/src/tus/finance/servicios/mercado-pago.ts` salvo que se indique otra cosa. Test: `tests/foundation/tus-mercado-pago-calidad.test.mjs` (captura la preferencia con un transporte falso).

| Requisito | Estado | Evidencia | Pendiente manual |
| --- | --- | --- | --- |
| Credenciales de producción separadas de las de prueba | Listo en código | `MERCADO_PAGO_ENVIRONMENT`; el checkout usa `init_point` en producción y `sandbox_init_point` en sandbox | Confirmar en Hostinger que las credenciales cargadas son las de **producción** de la aplicación (valor: no mostrar; solo CONFIGURADO / AUSENTE) |
| Checkout Pro por preferencia | Listo | `POST /checkout/preferences` con el access token de la cuenta de TUS | — |
| `items[].id` | Listo | id de la intención de pago | — |
| `items[].title` | Listo | "Seña (50%) del turno TUS", "Saldo (50%) del trabajo TUS" o el nombre del servicio (hasta 250) | — |
| `items[].description` | **Agregado** (MP-CALIDAD-01) | "Pago de un turno reservado en TUS" / "Pago de un servicio contratado en TUS" | — |
| `items[].quantity` | Listo | siempre 1 | — |
| `items[].currency_id` | Listo | `ARS` | — |
| `items[].unit_price` | Listo | importe exacto desde unidades menores, sin flotantes | — |
| `items[].category_id` | **Agregado, apagado hasta configurarlo** | `MERCADO_PAGO_ITEM_CATEGORY_ID` (vacío: no se envía) | Elegir la categoría que Mercado Pago lista para servicios en el panel/medición y cargarla. No se adivinó un valor |
| `items[].picture_url` | No se envía | TUS no tiene una imagen por servicio | Solo si la medición lo pide: decidir qué imagen (logo de TUS) |
| `payer.email`, `payer.name`, `payer.surname` | **Agregado** | Se envían cuando el tenant del cliente tiene exactamente una cuenta activa (`composition/index.ts`). Email inválido o nombre vacío se omiten; si la consulta falla, el checkout se crea igual | Verificar en la primera medición que cuenta como "información del comprador" |
| `payer.phone`, `payer.identification`, `payer.address` | No se envían | TUS no manda teléfono, DNI ni domicilio del cliente a Mercado Pago | **Decisión del dueño** (privacidad): solo si la medición los exige para llegar a 100 |
| `external_reference` | Listo | id de la intención de pago; es la clave de conciliación | — |
| `metadata` | Listo | `tus_payment_id` | — |
| `notification_url` | Listo | `MERCADO_PAGO_NOTIFICATION_URL` (HTTPS obligatorio; el arranque falla si no lo es) | Confirmar en el panel que la aplicación tiene Webhooks activos para el tópico de pagos, apuntando a `https://api.tusservicios.shop/tus/v1/integrations/mercado-pago/webhooks` |
| `back_urls` (success, pending, failure) | Listo | vuelven a `/mis-turnos?pago=retorno` o a la página del trabajo | — |
| `auto_return` | Listo | `approved` | — |
| `statement_descriptor` | **Agregado, apagado hasta configurarlo** | `MERCADO_PAGO_STATEMENT_DESCRIPTOR` (hasta 22 caracteres; vacío: no se envía) | Decidir el texto del resumen de tarjeta (por ejemplo "TUS") y cargarlo |
| `binary_mode` | No se envía | El flujo de TUS admite pagos pendientes (el turno queda esperando el pago) | No activar salvo decisión: con `binary_mode` se pierden los medios en efectivo/pendientes |
| Expiración de la preferencia | No se envía | La solicitud de turno ya vence sola (`solicitud_expira_en`); un pago que llega tarde se trata como tardío | Evaluar solo si la medición lo pide |
| Webhook: firma | Listo | `verificarFirmaMercadoPago`: HMAC de `id` (query `data.id`), `x-request-id` y `ts`; ventana de 5 minutos; `ts` en segundos o milisegundos | — |
| Webhook: `data.id` por query y `x-request-id` | Listo | parte del manifiesto firmado | — |
| Webhook: repetición / idempotencia | Listo | cada evento se registra una vez; repetido responde `duplicate` sin volver a aplicar | — |
| Relectura del pago en la API | Listo | `GET /v1/payments/{id}` antes de aplicar; nunca se confía en el cuerpo del aviso | — |
| Estados | Listo | `approved`, `pending` (`authorized`, `in_process`, `in_mediation`), `rejected`, `cancelled`, `expired`, `refunded`, `charged_back` | — |
| Conciliación | Listo | búsqueda por `external_reference` (`/v1/payments/search`), validando cobrador e importe | — |
| Reintentos | Listo | creación idempotente (`X-Idempotency-Key` = id de la intención) | — |
| Logs sin secretos | Listo | el middleware de logs redacta `authorization`, `token`, `secret`, `cookie`; tokens cifrados en reposo | — |
| Experiencia de retorno y mobile | Listo en local | smoke de navegador a 390 y 1280 (`scripts/dev/pagos-servicios-smoke.mjs`) con checkout simulado | Verificar con el primer pago real |
| SDK oficial de backend / MercadoPago.js | No se usa | TUS llama a la API REST directamente y usa el checkout alojado (redirección) | La página oficial clasifica el SDK de frontend como **buena práctica** (no afecta el puntaje). Si la medición descuenta por "SDK de backend", es una decisión técnica aparte |

## OAuth de la cuenta del prestador (para retirar)

| Requisito | Estado | Evidencia |
| --- | --- | --- |
| Authorization Code + PKCE S256 | Listo | `cuentas-cobro.ts` → `iniciarConexion` (`code_challenge`, `code_challenge_method=S256`) |
| `code_verifier` seguro | Listo | 48 bytes aleatorios, guardado cifrado con el estado |
| `state` de un solo uso y con vencimiento | Listo | 32 bytes, se guarda su huella, vence a los 10 minutos, se consume al volver |
| Redirect exacto | Listo en código | sale de `MERCADO_PAGO_OAUTH_REDIRECT_URI`; debe ser `https://api.tusservicios.shop/tus/v1/integrations/mercado-pago/oauth/callback` |
| Intercambio del código, refresh, cifrado de tokens | Listo | `cuentas-cobro.ts`; los tokens nunca salen de la API |
| Desvincular / volver a vincular / una cuenta por prestador | Listo | única por `(prestador, proveedor)`; auditado (`payment_account.connected/reconnected/disconnected`) |
| Autorización de TUS para vincular | Corregido | `fix/mercado-pago-oauth-autorizacion` (`d781db8`), integrado en esta rama: 401 sin sesión, 403 `FORBIDDEN`, 403 `PROVIDER_REQUIRED`, 503 `PAYMENTS_UNAVAILABLE` |

### "La aplicación no está preparada para conectarse a Mercado Pago"

Ese mensaje lo muestra **Mercado Pago**, después de salir de TUS. No se pudo reproducir desde acá (no se vinculan cuentas reales). Lo que hay que revisar en el panel de la aplicación, en este orden:

1. Que la **Redirect URL** cargada sea exactamente la de arriba (sin barra final, mismo esquema y host).
2. Que **PKCE** esté habilitado en la aplicación (TUS siempre envía `code_challenge`).
3. Que la aplicación tenga los permisos `read`, `write` y `offline_access`.
4. Que la aplicación esté en **producción** (credenciales productivas activadas) y que el modelo de integración elegido admita OAuth de vendedores. Si el panel pide un modelo "Marketplace" para habilitar OAuth, es un requisito externo que no se resuelve en el código.

No se afirma cuál de los cuatro es: hace falta la prueba manual. Anotar el texto exacto y la URL de la pantalla de error si vuelve a aparecer.

## Procedimiento para llegar a 100

1. Desplegar esta rama (con su respaldo y ensayo de migraciones).
2. Cargar `MERCADO_PAGO_STATEMENT_DESCRIPTOR` y, si el panel indica la categoría, `MERCADO_PAGO_ITEM_CATEGORY_ID`.
3. Hacer **un pago real barato** (ver `docs/PRUEBA_PAGO_REAL_TUS.md`) y anotar el payment ID.
4. Panel → *Tus integraciones → la aplicación → Calidad de integración → Medir* con ese payment ID.
5. Copiar acá cada acción que descuente puntos (nombre exacto y tipo), corregir y repetir desde el paso 3.
