# Design - importline

A dense, boring operations UI. Server components render everything static; the only client
components are the upload form, the mapping table, the progress poller, and confirm dialogs.
Scannability beats flair: the operator's core activities are reading a validation report and
watching a progress bar. Light theme only in v1.

## Color & theme

Tailwind tokens (extend the default palette in `tailwind.config.ts`):

| Token | Hex | Use |
|---|---|---|
| `bg` | `#f6f7f9` | Page background |
| `surface` | `#ffffff` | Cards, tables |
| `border` | `#d9dde3` | Borders, table rules |
| `text` | `#1f2933` | Body text |
| `muted` | `#57606a` | Secondary text, timestamps |
| `accent` | `#1d4ed8` | Links, primary buttons, focus rings, progress fill |
| `danger` | `#b91c1c` | Destructive buttons, error text |

Import state badges (background / text; label text always accompanies the color):

| State | Background | Text |
|---|---|---|
| `uploaded` / `validating` | `#e5e7eb` | `#374151` |
| `validated` | `#dbeafe` | `#1e40af` |
| `applying` | `#dbeafe` | `#1e40af` |
| `completed` | `#d1fae5` | `#065f46` |
| `paused` | `#fef3c7` | `#92400e` |
| `cancelled` | `#e5e7eb` | `#374151` |
| `failed` | `#fee2e2` | `#991b1b` |

Report severity: `error` uses the failed scheme, `warning` the paused scheme.

## Typography & spacing

- System font stack for UI; monospace (`ui-monospace, Menlo, Consolas`) for SKUs, hashes, file
  names, error codes, and cell values.
- Scale (rem): page title 1.5/600; section heading 1.125/600; body and cells 0.9375/400; small
  (badges, table headers, timestamps) 0.8125/500. Line height 1.5 body, 1.3 headings.
- Spacing on a 4/8 px system; table cell padding 8x12; card padding 16; page gutter 24; max
  content width 1200 px centered. Radius 6 px cards/inputs, 9999 px badges. One subtle card
  shadow; nothing else elevates.

## Screens

- **Imports history (`/imports`, home)** - Table: id, source label, filename, catalog, state
  badge, rows, created/updated/skipped/error counts, started, duration. Row links to detail.
  Primary button "New import". Empty state: "No imports yet. Start your first import."
- **New import (`/imports/new`)** - Catalog select (seeded default preselected), optional source
  label, file input, upload button with in-flight progress (browser upload progress, then
  redirect to mapping). Errors (413, bad type) render inline above the form.
- **Mapping (`/imports/[id]/mapping`)** - Detection summary line (delimiter, encoding, an
  "uncertain, override below" warning when flagged) with override selects. A two-column mapping
  table: CSV header + sample values (first rows) on the left, target field select (or "ignore")
  on the right. Template bar: matched template name pre-filled, "save as template" name input.
  Validate button disabled until sku, name, and price are mapped, with an inline note saying why.
- **Import detail (`/imports/[id]`)** - Header: state badge, source label, file meta, actions
  (Apply, Cancel, Resume - rendered only when the state machine allows them, destructive ones
  behind a confirm dialog). During validating/applying: progress bar (processed/total rows,
  current batch) polled every 2 s; polling stops on terminal states. Cards: dry-run summary
  (would create/update/skip), apply results (created/updated/skipped), pause banner with reason
  and failing batch when paused. Tabs: Report (paginated table: row, column, code, severity,
  message; severity/code filters; "Download CSV" link) and Changes (paginated audit: sku,
  action, changed fields as old -> new in monospace).
- **Products (`/products`)** - Catalog select, search box (SKU or name), paginated table: sku,
  name, price (formatted from cents), stock, category, updated, last import link. Empty and
  filtered-to-empty states with a clear-search link.
- **Templates (`/templates`)** - Table: name, fields mapped count, last used; delete behind
  confirm. Empty state explains templates are saved from the mapping screen.

## States & feedback

- Every interactive element defines default, hover, focus, disabled. Buttons: primary (accent),
  secondary (bordered), danger. Disabled buttons carry the `disabled` attribute and a reason in
  `title` where non-obvious.
- Progress is polled, never spinning blindly: the bar always shows numbers (rows, batch x of y).
  A failed poll shows a quiet "connection lost, retrying" note without clearing last-known data.
- Mutations use forms/buttons that disable while in flight and re-enable on error with the error
  envelope's message rendered inline. No toasts; feedback appears where the action happened.
- Empty states everywhere a table can be empty; filtered-to-empty says so and offers a reset.

## Accessibility baseline

- Semantic HTML: one `h1` per page, `nav`/`main` landmarks, real `table`/`th scope="col"`, real
  `button`/`a`, `html lang="en"`.
- Every input labeled; the mapping table associates each select with its header via `aria-label`.
- Progress bar is a `progress` element with text alternative (rows processed of total).
- Fully keyboard-navigable; visible 2 px accent focus ring; no `outline: none` without a
  replacement. Status conveyed by text plus color, never color alone. Contrast meets WCAG AA.
- Layout readable at 320 px: tables scroll horizontally inside their card, never the page.
