# Schema Drift Detector Plugin for Voiden

Detect and visualize structural changes, breaking regressions, and schema evolutions in API responses across executions.

## Features
- **JSON & XML Support**: Automatically infer deep structural schemas from JSON and XML response payloads.
- **Breaking Change Detection**: Flags removed fields, mutated types, array element structure changes, and nullability shifts.
- **Additive & Non-Breaking Evolution**: Tracks new fields and optional extensions without cluttering breaking alerts.
- **Flexible Ignore Rules**: Ignore dynamic fields (e.g. `*.timestamp`, `id`, `_id`, `updatedAt`, `data[].token`) using exact, wildcard, or regex pattern matching.
- **Baseline Schema Management**: Set, lock, update, or auto-record baseline schemas per request endpoint or `.void` file.
- **Native Response Panel Integration**: Seamless collapsible response panel view with status badges, change filters, and diff details.
- **Export & Report Generation**: Export drift reports directly into Markdown, JSON, HTML, or plain text formats.
- **CI & Headless Ready**: Programmatic comparator API and runner for automated drift testing.

## Usage
1. Execute any REST or API request in Voiden.
2. The Schema Drift Detector records the initial response schema as the baseline.
3. On subsequent executions, any drift in response fields or types will be automatically detected and highlighted in the Response Panel.
4. Add ignore rules or update baseline as your API evolves.
