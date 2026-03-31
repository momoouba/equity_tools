---
name: frontend-list-standards
description: Standardizes frontend table/list pages in this repo. Use when creating or updating any list/table page, pagination area, action buttons, numeric/date formatting, fixed columns, tab style, scroll behavior, and layout spacing.
---

# Frontend List Standards

Apply this skill to all list/table pages in this project.

After implementation, run `frontend-standards-audit-fix` to verify every requirement was truly applied and auto-fix missing items.

## Required UI Standards

1. **Pagination style**
- Use Arco table pagination with:
  - `sizeCanChange: true`
  - `showTotal: true`
  - `showJumper: true`
  - `pageSizeOptions: [20, 50, 100, 200]`
  - `pageSizeChangeResetCurrent: true`
- Default `pageSize` should be `100` for data-heavy pages unless user says otherwise.

2. **Table body and borders**
- Enable zebra stripes: `stripe`
- Enable visible grid lines between columns: `border` (or cell/wrapper border config)
- Column separators must be clearly visible; if component defaults are inconsistent, add page-level CSS to force vertical cell borders.
- Recommended fallback CSS:
  ```css
  .page-scope .arco-table .arco-table-th,
  .page-scope .arco-table .arco-table-td { border-right: 1px solid #e5e6eb !important; }
  .page-scope .arco-table .arco-table-th:last-child,
  .page-scope .arco-table .arco-table-td:last-child { border-right: none !important; }
  ```

3. **Fixed columns and scrolling**
- Operation column must be fixed right: `fixed: 'right'`
- Operation column width: calculate based on button count. Formula: `(buttonCount * buttonWidth) + (buttonCount + 1) * 10` (each button has 10px space on left and right). Example: 3 buttons inline → `width: 180` (3×40 + 4×10 = 160, add padding buffer)
- Wrap buttons in `<Space size={8} style={{ padding: '0 10px' }}>` to ensure 10px margin on both sides
- Horizontal scroll enabled (`scroll.x`) when column count/width is large.
- **Vertical scroll must be table-only**: use `scroll.y` to make only the table body scrollable
- Top controls (title, filter buttons, search) must remain fixed while scrolling
- Use dynamic `tableScrollY` calculated from window height:
  ```jsx
  const [tableScrollY, setTableScrollY] = useState(520)
  useEffect(() => {
    const calc = () => {
      const y = Math.max(320, window.innerHeight - 280)
      setTableScrollY(y)
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])
  ```
- For `ListingProjectProgressPage`, lock this baseline as standard: `const y = Math.max(320, window.innerHeight - 280)`.

4. **Action button style**
- `编辑`: blue (`type="primary"` or blue outline variant if page uses outline)
- `日志`: green outline (`type="outline" status="success"`)
- `删除`: red outline (`type="outline" status="danger"`)
- `测试`: black/default dark style consistent with page
- New action buttons should follow current system style and visual hierarchy.

5. **Data formatting**
- **Date/time**: display in Beijing time for computed/converted data.
- If external API/crawler already returns final business date string, use it directly; do not re-encode or mutate source semantics.
- If the table date/time comes from DB fields (for example `created_at`, `f_update_time`), render raw DB value directly; do not slice, timezone-convert, or format on frontend unless user explicitly asks.
- **Amount**: thousand separators with 2 decimals in list display.
- **Percent**: show with `%` and keep 2 decimals.
- **Name/text fields**: prioritize full display (reasonable width + ellipsis only when truly needed).

6. **Tab style**
- Use `type="line"` for Tabs component (consistent with SystemConfig, NewsInfo, etc.)
- Tab titles should be clear and concise
- First tab should contain the main data/list content
- Keep Tab margin compact: `style={{ marginBottom: 8 }}`
- **Margin rule**: 
  - If the content below Tab (including filters, buttons, table) is wrapped in a container `<div>` that directly follows `<Tabs>`, the container should **align with menu bottom** (no top margin).
  - Only add `marginTop: 10` when there is no container wrapper and the content starts directly under Tabs.
- For pages that are primarily "Tab + list", use a compact structure: `Tabs` as first content block, then filter/actions, then table

7. **Layout spacing**
- Reduce excessive top padding/margin
- Button row margin: `marginBottom: 8`
- Table container should fill remaining height

## Implementation Checklist

Use this checklist before finishing any list page:

- [ ] Pagination shows page-size selector, total, range, and jumper
- [ ] Zebra + grid lines enabled
- [ ] Every table column has visible separator lines (not only outer border)
- [ ] Operation column fixed right, width calculated by button count with 10px padding on both sides
- [ ] **Table uses `scroll.y` for body-only scroll (top controls fixed)**
- [ ] `tableScrollY` dynamically calculated from window height
- [ ] Action buttons follow color standard
- [ ] Amount and percent formatting are correct
- [ ] Date handling follows Beijing/direct-source rule
- [ ] DB date fields are shown as raw values (no frontend slicing/conversion by default)
- [ ] Tabs use `type="line"` style
- [ ] Tab area keeps `10px` distance from menu bottom
- [ ] "Tab + list" pages follow compact layout (Tabs first, then controls + table)
- [ ] Layout spacing is compact (no excessive top margin)

## Quick Snippets

```jsx
// Dynamic table scroll height
const [tableScrollY, setTableScrollY] = useState(520)
useEffect(() => {
  const calc = () => {
    const y = Math.max(320, window.innerHeight - 280)
    setTableScrollY(y)
  }
  calc()
  window.addEventListener('resize', calc)
  return () => window.removeEventListener('resize', calc)
}, [])
```

```jsx
pagination={{
  current: page,
  pageSize,
  total,
  sizeCanChange: true,
  pageSizeChangeResetCurrent: true,
  showTotal: true,
  showJumper: true,
  pageSizeOptions: [20, 50, 100, 200],
  onChange: (p, ps) => { setPage(p); if (ps !== pageSize) setPageSize(ps) },
  onPageSizeChange: (ps) => { setPage(1); setPageSize(ps) },
}}
```

```jsx
<Button type="primary" size="small">编辑</Button>
<Button type="outline" status="success" size="small">日志</Button>
<Button type="outline" status="danger" size="small">删除</Button>
```

```jsx
<Tabs defaultActiveTab="list" type="line" style={{ marginBottom: 8 }}>
  <TabPane key="list" title="列表">
    {/* Table content */}
  </TabPane>
</Tabs>
```
