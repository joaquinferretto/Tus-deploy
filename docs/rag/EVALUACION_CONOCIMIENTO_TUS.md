# Evaluación del conocimiento de TUS

Dataset: `tests/foundation/fixtures/rag-eval-tus.json`. Runner: `tests/foundation/tus-rag-evaluacion.test.mjs` (corre en
la suite, sin proveedores externos). Se evalúa la ayuda pública (`ServicioAyudaPublica`, actor anónimo) sobre el corpus
real de `docs/conocimiento/`.

Cada caso declara la pregunta, si se espera respuesta (`answered`) o abstención (`low_confidence`), el documento que
debe quedar primero (`topDocument` o `anyDocument`) y, opcionalmente, la sección. Las fuentes prohibidas
(`forbiddenEverywhere`: `operacion-soporte-interno` interno y `cobros-prestador` de prestadores) nunca pueden aparecer.

Criterios:

| Modo                                      | Exige                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| Léxico (default productivo sin embeddings)| Estado correcto, documento correcto en primer lugar, sección si se declara, heading path sin repeticiones, cero fuentes prohibidas |
| Híbrido (embeddings locales deterministas)| Estado correcto, documento esperado entre las respuestas, cero fuentes prohibidas       |

Abstenciones esperadas (el RAG no es autoridad de negocio ni responde fuera de dominio): "¿Cuánto debo cobrarle a
Juan?" (dato vivo: tools), "¿Cuál es la capital de Francia?", el documento interno de soporte y coincidencias débiles
como "protección TUS garantía asegurada" (solo coincide la marca).

Para agregar un caso: escribirlo en el JSON, correr `node --test tests/foundation/tus-rag-evaluacion.test.mjs`, y si
falla por falta de contenido, completar el documento de `docs/conocimiento/` correspondiente (subiendo su `version`),
nunca aflojar el criterio. La misma evaluación se verificó contra PostgreSQL 16 real con `IndiceConocimientoPrisma`
(ingesta por CLI dos veces: la segunda no reindexa nada).
