---
name: api-document-generator-openapi
description: Generates and maintains OpenAPI 3.0+ (Swagger) API documentation from Express routes and database schemas. Use when creating external APIs, publishing API docs, adding OpenAPI/Swagger spec, or when the user asks for API documentation, 对外接口文档, or OpenAPI 3.0.
---

# API Document Generator (OpenAPI 3.0+)

## When to Use

- User asks for external API design, 对外访问接口, or API documentation
- Adding or updating OpenAPI 3.0 / 3.1 spec or Swagger docs
- Exposing existing Express routes or DB-backed endpoints as a documented API

## Workflow

1. **Discover endpoints**: Read `news/server/index.js` for mounted routes (e.g. `/api/enterprises`, `/api/news`). Read each route file for HTTP methods, paths, query/body params, and response shapes.
2. **Infer schemas from DB**: Use `news/server/db.js` and route handlers to infer request/response schemas (table columns → `properties`).
3. **Write or update** the OpenAPI document (YAML or JSON). Prefer a single file such as `openapi.yaml` or `docs/openapi.yaml` at project root or in `news/`.

## OpenAPI 3.0+ Structure

Use this skeleton; fill `paths` and `components.schemas` from routes and DB.

```yaml
openapi: 3.0.3
info:
  title: Equity News API
  description: 对外访问接口（基于当前数据库）
  version: 1.0.0
servers:
  - url: /api
    description: API base path (relative or set full URL for external docs)
paths:
  /enterprises:
    get:
      summary: 获取企业列表
      parameters: []
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  success: { type: boolean }
                  data: { type: array, items: { $ref: '#/components/schemas/Enterprise' } }
  /news:
    get:
      summary: 获取新闻列表
      parameters:
        - name: page
          in: query
          schema: { type: integer, default: 1 }
        - name: pageSize
          in: query
          schema: { type: integer, default: 20 }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  success: { type: boolean }
                  data: { type: array, items: { $ref: '#/components/schemas/NewsItem' } }
components:
  schemas:
    Enterprise:
      type: object
      properties:
        id: { type: string }
        enterprise_full_name: { type: string }
        unified_credit_code: { type: string, nullable: true }
        # add other columns from DB/response
    NewsItem:
      type: object
      properties:
        id: { type: string }
        title: { type: string }
        # infer from route responses and DB columns
```

## Conventions

- **Path prefix**: Routes are mounted under `/api` (e.g. `app.use('/api/enterprises', enterpriseRoutes)`). In OpenAPI, either set `servers[].url` to `https://your-host/api` or document paths as `/enterprises` with `servers[].url` = `/api`.
- **Auth**: If routes use `auth` middleware or tokens, add `securitySchemes` and `security` in the spec (e.g. `bearerAuth` or `apiKey`).
- **Errors**: Document common responses (400, 401, 404, 500) with a shared `Error` schema when relevant.
- **IDs**: This codebase uses string IDs (e.g. VARCHAR(19)); use `type: string` in schemas.

## From Express Route to Path Item

For a route like `router.get('/:id', ...)` in `routes/enterprises.js` mounted at `/api/enterprises`:

- Path: `/enterprises/{id}`
- Method: `get`
- Parameters: path parameter `id` (string)
- Responses: infer from `res.json(...)` in the handler (success + error cases)

Add `summary`, `description`, and request body for `post`/`put`/`patch` from validation (e.g. `express-validator` usage) and DB columns.

## Optional: Serve Docs in App

To expose the spec and Swagger UI:

- Place `openapi.yaml` (or `.json`) where the app can serve it (e.g. `news/server/` or `news/public/`).
- Add a route that returns the spec (e.g. `GET /api/openapi.json` → send file or object).
- Optionally use `swagger-ui-express` to serve `GET /api-docs` with the spec URL.

## Additional Resources

- For full OpenAPI 3.0/3.1 reference, see [reference.md](reference.md).
- For more path/schema examples, see [examples.md](examples.md).
