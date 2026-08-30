# TUS Web Recovery and Interaction Polish Specification

## Purpose

Refine recovery and web interactions so protected journeys remain understandable, operable, and honest across input methods and presentation preferences.

## Requirements

### Requirement: Semantic recovery structure

Recovery and protected web surfaces MUST provide a navigational landmark, one meaningful page heading, a skip-to-main control, logical focus order, and actionable reauthentication or retry content. Recovery MUST NOT display or accept credentials, tenant, actor, or permission authority.

#### Scenario: Keyboard recovery

- GIVEN an expired session opens the recovery route
- WHEN a keyboard user tabs through the page
- THEN the skip link, navigation, heading, explanation, and secure sign-in action are discoverable in order and protected data remains withheld

#### Scenario: Error focus

- GIVEN a recoverable error is rendered in a protected surface
- WHEN the error state becomes active
- THEN its status is announced, its retry or refresh action is reachable, and focus is not trapped or moved to an unrelated control

### Requirement: Visible interaction states

Links, buttons, fields, and selectable controls MUST expose visible focus, hover, pressed, disabled, and loading states where applicable. Primary actions MUST remain understandable without hover, color, or animation and MUST meet touch-safe sizing.

#### Scenario: Pointer and touch interaction

- GIVEN a user operates landing, navigation, POS, or recovery controls with pointer or touch
- WHEN a control is hovered, pressed, disabled, or loading
- THEN its state is visually distinguishable, its label remains readable, and the control remains operable without a hover-only affordance

#### Scenario: Reduced motion

- GIVEN the user requests reduced motion
- WHEN page reveals, scrolling, or status transitions occur
- THEN non-essential animation and smooth scrolling are reduced while focus, status, and action feedback remain available

### Requirement: Responsive long-content composition

Web surfaces MUST preserve readable hierarchy and action access at narrow widths, zoom, and enlarged text. Long headings, status evidence, support copy, and identifiers MUST wrap or reflow without clipping or horizontal scrolling.

#### Scenario: Narrow recovery and POS layout

- GIVEN a narrow viewport or enlarged text setting
- WHEN recovery, POS, or partial-error content renders
- THEN headings and messages reflow, controls remain reachable, and no information depends on hidden overflow

#### Scenario: Semantic heading hierarchy

- GIVEN a screen reader or document inspection evaluates the landing page
- WHEN card and section headings are traversed
- THEN heading levels reflect the page hierarchy and card links have descriptive accessible names
