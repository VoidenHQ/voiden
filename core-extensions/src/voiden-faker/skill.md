## Extension: Voiden Faker

Provides `{{$faker.*()}}` syntax for generating fake/random data inline in any block field. Values are generated fresh on each request.

### Syntax

```
{{$faker.category.method()}}
{{$faker.category.method(arg1, arg2)}}
```

### Common Faker Methods

#### Person

```
{{$faker.person.firstName()}}          → "John"
{{$faker.person.lastName()}}           → "Doe"
{{$faker.person.fullName()}}           → "John Doe"
{{$faker.internet.email()}}            → "john.doe@example.com"
{{$faker.internet.userName()}}         → "john_doe42"
{{$faker.internet.password()}}         → "xK9#mP2!qR"
```

#### Numbers & IDs

```
{{$faker.string.uuid()}}               → "550e8400-e29b-41d4-a716-446655440000"
{{$faker.number.int()}}                → 42
{{$faker.number.int({"min":1,"max":100})}}  → 73
{{$faker.number.float({"precision":0.01})}} → 3.14
```

#### Text

```
{{$faker.lorem.word()}}                → "lorem"
{{$faker.lorem.sentence()}}            → "Lorem ipsum dolor sit amet."
{{$faker.lorem.paragraph()}}           → "..."
{{$faker.lorem.words(3)}}              → "lorem ipsum dolor"
```

#### Location

```
{{$faker.location.city()}}             → "New York"
{{$faker.location.country()}}          → "United States"
{{$faker.location.streetAddress()}}    → "123 Main St"
{{$faker.location.zipCode()}}          → "10001"
```

#### Date & Time

```
{{$faker.date.past()}}                 → ISO date string
{{$faker.date.future()}}               → ISO date string
{{$faker.date.recent()}}               → ISO date string
```

#### Commerce

```
{{$faker.commerce.productName()}}      → "Ergonomic Steel Chair"
{{$faker.commerce.price()}}            → "42.99"
{{$faker.company.name()}}              → "Acme Corp"
```

#### Phone

```
{{$faker.phone.number()}}              → "+1-555-123-4567"
```

### Usage in Blocks

In a JSON body:

```yaml
---
type: json_body
attrs:
  uid: "uid"
  body: |
    {
      "id": "{{$faker.string.uuid()}}",
      "name": "{{$faker.person.fullName()}}",
      "email": "{{$faker.internet.email()}}",
      "age": {{$faker.number.int({"min":18,"max":80})}}
    }
---
```

In a headers-table:

```yaml
content:
  - type: table
    rows:
      - attrs: { disabled: false }
        row: [X-Request-ID, "{{$faker.string.uuid()}}"]
      - attrs: { disabled: false }
        row: [X-Correlation-ID, "{{$faker.string.uuid()}}"]
```

In a query-table:

```yaml
content:
  - type: table
    rows:
      - attrs: { disabled: false }
        row: [search, "{{$faker.commerce.productName()}}"]
```
