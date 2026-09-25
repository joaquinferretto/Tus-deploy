---
name: tus-identity
description: Verificación de identidad de prestadores en TUS (DNI, OCR, visión, Nosis, cola del worker, gates de prestador). Usar al tocar el módulo de identidad, el worker de Nosis, documentos de identidad o las restricciones de prestadores no verificados.
---

# TUS: identidad de prestadores

Referencia canónica: `docs/IDENTIDAD_PRESTADORES_TUS.md`.

## Datos
- Las imágenes de DNI son privadas: sin metadata, cifradas, nunca con URL pública; solo el dueño y el admin de plataforma acceden (ver `tus-security`).
- Extraer y guardar solo lo necesario (DNI, nombre, CUIL y un resultado mínimo); no almacenar páginas ni datos extra de Nosis.

## Flujo
- Lectura con OCR + Groq Vision; ambas lecturas deben coincidir antes de gastar una consulta externa.
- Nosis detrás de una abstracción de proveedor (navegador hoy, API a futuro) con el mismo camino de cola, límite y matching.
- Cola FIFO persistente con lease atómico en la base; el HTTP solo encola y responde inmediato.
- Límite global de TUS: máximo 7 consultas por hora (ventana deslizante, persistente, compartida entre workers).
- Sesión del navegador persistida cifrada; sesión vencida pausa las consultas sin rechazar identidades.
- reCAPTCHA, hCaptcha, Turnstile u otros desafíos externos nunca se automatizan: requieren intervención humana.

## Gates
- Un prestador no verificado no publica servicios, no acepta trabajos, no conecta Mercado Pago y no cobra. Se aplica en el backend.
- Tests con personas ficticias; consultas reales solo con autorización y datos propios del operador.
