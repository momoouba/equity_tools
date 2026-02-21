# OpenAPI 3.0+ Reference (Quick)

## Top-Level Keys

| Key | Purpose |
|-----|---------|
| `openapi` | Use `3.0.3` or `3.1.0` |
| `info` | title, description, version |
| `servers` | Base URL(s) for the API |
| `paths` | Path-to-operations map |
| `components` | Reusable schemas, securitySchemes, etc. |

## Path Item

Each path can have: `get`, `post`, `put`, `patch`, `delete`, `options`, `head`, `trace`.

Each operation can include:

- `summary`, `description`
- `operationId` (unique, used by codegen)
- `tags` (grouping in UI)
- `parameters`: array of query, path, header, cookie
- `requestBody` (for post/put/patch): `content.{mediaType}.schema`
- `responses`: status code → `description` + `content.{mediaType}.schema`
- `security`: overrides global security
- `deprecated`: boolean

## Parameter

```yaml
- name: id
  in: path   # path | query | header | cookie
  required: true
  schema:
    type: string
  description: optional
```

## Request Body

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        $ref: '#/components/schemas/EnterpriseCreate'
```

## Response

```yaml
responses:
  '200':
    description: Success
    content:
      application/json:
        schema:
          type: object
          properties:
            success: { type: boolean }
            data: { $ref: '#/components/schemas/Enterprise' }
  '400':
    description: Bad Request
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/Error'
```

## Schema (components.schemas)

- `type`: string, number, integer, boolean, array, object
- `properties`, `required`
- `nullable: true` for optional DB columns
- `format`: date, date-time, uuid, etc.
- `$ref: '#/components/schemas/Name'` for reuse

## Security

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
security:
  - bearerAuth: []
```

## This Project’s Route Base

From `news/server/index.js`, API base is `/api`; routes:

- `/api/auth`
- `/api/enterprises`
- `/api/companies`
- `/api/system`
- `/api/qichacha`
- `/api/news`
- `/api/additional-accounts`
- `/api/ai-config`
- `/api/ai-prompt-config`
- `/api/news-analysis`
- `/api/email`
- `/api/scheduled-tasks`
- `/api/external-db`
- `/api/news-share`

Document paths relative to `/api` (e.g. `/enterprises`, `/news`).
