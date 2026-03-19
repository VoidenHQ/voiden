## Extension: Simple Assertions

Provides the `assertions-table` block for writing test assertions against HTTP responses. Insert with `/assertions` slash command.

### assertions-table — Response Assertions

```yaml
---
type: assertions-table
attrs:
  uid: "uid"
content:
  - type: table
    rows:
      - attrs: { disabled: false }
        row: ["Status is 200", "status", "equals", "200"]
      - attrs: { disabled: false }
        row: ["Has user id", "body.id", "exists", ""]
      - attrs: { disabled: false }
        row: ["Name is John", "body.name", "equals", "John"]
      - attrs: { disabled: false }
        row: ["Has items", "body.items", "contains", "product"]
      - attrs: { disabled: true }
        row: ["Response time", "responseTime", "lessThan", "500"]
---
```

Row format: `[description, field, operator, expected-value]`

### Field Paths

| Field | Description |
|-------|-------------|
| `status` | HTTP status code (e.g. `200`, `404`) |
| `body` | Full response body |
| `body.field` | JSONPath into response body |
| `body.nested.field` | Nested JSONPath |
| `headers.content-type` | Response header value |
| `responseTime` | Response time in milliseconds |

### Operators

| Operator | Description | Example expected |
|----------|-------------|-----------------|
| `equals` | Exact match | `"200"`, `"John"` |
| `notEquals` | Does not match | `"error"` |
| `contains` | String contains | `"success"` |
| `notContains` | Does not contain | `"error"` |
| `exists` | Field is present (non-null) | `""` (leave empty) |
| `notExists` | Field is absent or null | `""` |
| `matches` | Regex match | `"^[0-9]+$"` |
| `greaterThan` | Numeric greater than | `"0"` |
| `lessThan` | Numeric less than | `"1000"` |

### Common Assertion Patterns

```yaml
# Check status code
row: ["Success response", "status", "equals", "200"]

# Check a body field exists
row: ["Has ID", "body.id", "exists", ""]

# Check a body field value
row: ["Correct name", "body.name", "equals", "John Doe"]

# Check response time under 500ms
row: ["Fast response", "responseTime", "lessThan", "500"]

# Check header value
row: ["JSON content type", "headers.content-type", "contains", "application/json"]

# Check nested field
row: ["Has email", "body.user.email", "exists", ""]
```
