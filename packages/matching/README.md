# @finance-os/matching

Pure payment → invoice matching engine: `(transaction, openInvoices, clientHistory) → MatchResult`.

**No Prisma, no network** (AGENTS.md #4) — enforced by an ESLint rule.

## Algorithm

`matchTransaction(tx, openInvoices, history, opts?)` — first rule that applies wins:

1. `direction !== 'in'` → `unmatched`.
2. `muxedId` present → look up `Invoice.paymentRefId` (**method `muxed`**, confidence 1).
3. Else a `text` memo parsed by `parseInvoiceMemo` (`INV42`, case/whitespace tolerant; from
   `@finance-os/shared`) → look up `paymentRefId` (**method `memo`**, confidence 1).
   A muxed id always beats a conflicting memo.
4. Reference present but no payable invoice has it (unknown, `draft`, `void`, `paid`) →
   `flagged: unknown_reference`.
5. Reference found but asset code **or** issuer differ → `flagged: wrong_asset` (with `invoiceId`; never matched).
6. No reference → `suggested` candidates (never `matched`). Same asset is required; score is
   exact outstanding amount (0.5) + sender in client's `knownAddresses` (0.3) + `createdAt` within
   `suggestionWindowDays` (default 14) of `dueDate` (0.2). Candidates need at least one signal, are sorted
   by score desc, capped at `maxSuggestions` (default 5); none → `unmatched`.

**Amounts:** `matched` carries `appliedAmount` (credited, capped at the balance), `remaining`, and
`newStatus` (`partially_paid` | `paid`). **Overpayments are applied *and* flagged:** the result stays
`matched` (invoice → `paid`) with `overpaidBy` = excess (`"0.0000000"` when there is none); the caller should surface it for review.

All math uses `@finance-os/shared` stroop-exact helpers; no `Number`/`parseFloat`. No clock reads.
