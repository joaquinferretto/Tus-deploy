# TUS Responsive and PWA Experience Specification

## Purpose

Make TUS usable across Argentina-first web contexts and mobile form factors without changing backend authority or overstating installability evidence.

## Requirements

### Requirement: Responsive and touch-safe surfaces

Web and mobile surfaces MUST remain readable, operable, and content-complete across narrow and wide viewports, touch input, keyboard input, safe areas, and text-size changes. Touch targets MUST not depend on hover or gesture-only behavior.

#### Scenario: Narrow viewport

- GIVEN a customer or staff surface is opened on a narrow viewport
- WHEN navigation, forms, cards, queues, and status messages render
- THEN content does not require horizontal scrolling and every primary action remains reachable and labeled

#### Scenario: Touch and safe area

- GIVEN a touch device has a notch, inset, or delayed click behavior
- WHEN the user operates navigation, POS, retry, or conflict actions
- THEN controls remain within safe areas, have touch-safe hit regions, and offer a non-gesture alternative

### Requirement: Argentina-first document and install metadata

The web experience MUST declare the intended Spanish/Argentina document locale, use Argentina-compatible currency/date presentation through locale-aware APIs, and expose coherent title, description, theme/background colors, start URL, and real PWA icon metadata.

#### Scenario: Metadata inspection

- GIVEN the web application is built
- WHEN document and manifest metadata are inspected
- THEN language, product description, start URL, theme/background colors, and icon entries are present and internally consistent

#### Scenario: Locale-aware values

- GIVEN a listing, amount, or timestamp has server-provided currency and locale facts
- WHEN it is rendered
- THEN formatting uses those facts and does not hardcode a misleading payment, settlement, or completion interpretation

### Requirement: Evidence separated by execution environment

Deterministic metadata, component, and style checks MUST be reported separately from browser rendering, installability, responsive, keyboard, and physical-device evidence. Missing browser/device execution MUST remain explicitly deferred.

#### Scenario: Deterministic pass only

- GIVEN metadata/component tests pass but no browser or device run was recorded
- WHEN readiness is reported
- THEN only deterministic behavior is claimed and browser/device evidence is marked unavailable or deferred

#### Scenario: Browser/device observation

- GIVEN a browser or device run records viewport, focus, install, or safe-area behavior
- WHEN evidence is attached
- THEN it identifies the environment, path, and observed result without generalizing beyond that run
