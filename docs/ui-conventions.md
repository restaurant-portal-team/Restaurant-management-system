# UI conventions (F04)

How every screen in the Restaurant Management Portal is built. Applies to all features from F05 onward.

## Layouts and shells

| Layout | File | Used for | Auth |
| ------ | ---- | -------- | ---- |
| Public | `frontend/src/layouts/root-layout.tsx` | `/`, `/login`, 404 | none |
| Staff shell | `frontend/src/layouts/staff-shell.tsx` | `/owner/*`, `/kitchen/*`, `/waiter/*` | `RequireAuth` (role must match) |
| Guest shell | `frontend/src/layouts/guest-shell.tsx` | `/menu`, `/cart`, `/my-orders` | none (customers are guests, decision A2) |

- The staff shell shows a persistent sidebar from the `lg` breakpoint (1024 px). Below it, the **Open navigation menu** button opens the same links in a modal drawer (native `<dialog>`): focus is trapped, Escape and the backdrop close it, focus returns to the button, and any route change closes it.
- The guest shell has no account menu, no staff links and never calls `/auth/*`.
- Route guards are UX only. Every permission is enforced by the API.

## Navigation is configuration

All links live in `frontend/src/app/navigation.ts` (`NAVIGATION`). Routes are generated from it, so a link can never point to a missing page.

To build a section in a later feature:
1. Keep the nav item, and replace its `page` with the real page component in `app/router.tsx` (`pageFor`).
2. Never add a link that exists only in the UI: the matching API must enforce the same role.

Until a section exists, its page shows `ComingSoonPage` ("Coming in F0x") — **never sample or fake data** (decision U2).

## Page structure

```tsx
<PageHeader eyebrow="Inventory" title="Ingredients" description="…" actions={<Button>Add ingredient</Button>} />
```

- Exactly one `PageHeader` (the page's only `<h1>`) per page.
- Data sections use: `LoadingState` / `Skeleton` while pending → `ErrorState` (with `onRetry`) on failure → `EmptyState` when the list is empty → `DataTable` / cards with real API data.
- Show only user-safe messages (`ApiError.message` is safe by design). Never show stack traces or raw server errors.

## Components (`frontend/src/components/ui/`)

| Component | Notes |
| --------- | ----- |
| `Button` | Variants `primary`, `secondary`, `ghost`. Always `type="button"` unless submitting. |
| `Card` | Raised surface with the card radius and shadow. |
| `FormField` + `TextInput` / `Select` | Wires `id`, `aria-describedby` (hint + error) and `aria-invalid` to the single child control. Client errors are hints; the server validates. |
| `DataTable` | Semantic `<table>` with a visible `<caption>`, `scope="col"` headers, horizontal scroll on small screens; pass `empty` to render an `EmptyState` instead of an empty table. |
| `Dialog` | Native `<dialog>` with `showModal()`; title is the accessible name, `description` the accessible description; `placement="left"` for drawers. Use for confirmations of destructive actions. |
| `EmptyState`, `ErrorState`, `LoadingState`, `Skeleton` | Standard states; `ErrorState` uses `role="alert"`, `LoadingState` uses `role="status"`. |
| `StatusBadge`, `Spinner`, `Icon` | `Icon` is a small inline SVG set (decision U4, no dependency), always decorative (`aria-hidden`); pair it with text or an `aria-label`. |

## Theme and accessibility

- Colours are OKLCH tokens in `frontend/src/styles/index.css`. The theme follows the system light/dark preference (decision U3). Status colours (`success`, `warning`, `danger`) are themed per mode.
- `frontend/src/styles/contrast.test.ts` enforces WCAG AA (4.5:1) for body, muted, accent, active-navigation, danger and status-badge text in both themes. Run it after changing any colour.
- Accent text uses `text-brand-700 dark:text-brand-300` (not `brand-600`, which fails AA as small text).
- Interactive targets are at least 44 px high (`min-h-11` / `size-11`); every page has a **Skip to content** link to `#main`; focus is always visible.
- Motion: `animate-fade-up` for entering content, `animate-slide-in-left` for the drawer. A global `prefers-reduced-motion` rule disables animations and transitions; components also add `motion-reduce:` variants.
- Never use `dangerouslySetInnerHTML` (blocked by ESLint).

## Tests to add with every new screen

- Renders inside the right shell and route; signed-out and wrong-role access is redirected (and the API test proves 401/403).
- Loading, error and empty states.
- Accessible names for forms, dialogs and tables (`getByRole` / `getByLabelText`).
