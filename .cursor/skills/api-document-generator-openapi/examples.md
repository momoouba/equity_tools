# OpenAPI Examples (Snippets)

## Path with path parameter and query

```yaml
/enterprises/{id}:
  get:
    summary: 获取单条企业
    parameters:
      - name: id
        in: path
        required: true
        schema: { type: string }
    responses:
      '200':
        description: OK
        content:
          application/json:
            schema:
              type: object
              properties:
                success: { type: boolean }
                data: { $ref: '#/components/schemas/Enterprise' }
      '404':
        description: Not found
```

## POST with request body

```yaml
/enterprises:
  post:
    summary: 新增企业
    requestBody:
      required: true
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/EnterpriseCreate'
    responses:
      '200':
        description: Created
        content:
          application/json:
            schema:
              type: object
              properties:
                success: { type: boolean }
                data: { $ref: '#/components/schemas/Enterprise' }
      '400':
        description: Validation error
```

## List with pagination

```yaml
/news:
  get:
    summary: 新闻列表（分页）
    parameters:
      - name: page
        in: query
        schema: { type: integer, default: 1 }
      - name: pageSize
        in: query
        schema: { type: integer, default: 20 }
      - name: keyword
        in: query
        schema: { type: string }
    responses:
      '200':
        description: OK
        content:
          application/json:
            schema:
              type: object
              properties:
                success: { type: boolean }
                data:
                  type: array
                  items: { $ref: '#/components/schemas/NewsItem' }
                total: { type: integer }
```

## Reusable schemas

```yaml
components:
  schemas:
    Enterprise:
      type: object
      properties:
        id: { type: string }
        project_abbreviation: { type: string, nullable: true }
        enterprise_full_name: { type: string }
        unified_credit_code: { type: string, nullable: true }
        wechat_official_account_id: { type: string, nullable: true }
        official_website: { type: string, nullable: true }
        enterprise_type: { type: string, nullable: true }
        exit_status: { type: string, nullable: true }
        project_number: { type: string, nullable: true }
      required: [id, enterprise_full_name]

    EnterpriseCreate:
      type: object
      properties:
        project_abbreviation: { type: string }
        enterprise_full_name: { type: string }
        unified_credit_code: { type: string }
        wechat_official_account_id: { type: string }
        official_website: { type: string }
        enterprise_type: { type: string }
        exit_status: { type: string }

    Error:
      type: object
      properties:
        success: { type: boolean, example: false }
        message: { type: string }
```

## Global security

```yaml
security:
  - bearerAuth: []

paths:
  /enterprises:
    get:
      security: []   # override: no auth for this operation
      ...
  /news:
    get:
      # uses global bearerAuth
      ...
```

Use these snippets when generating or extending the project’s OpenAPI spec.
