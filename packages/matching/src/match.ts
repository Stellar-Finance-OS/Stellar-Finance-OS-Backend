import {
  compareAmounts,
  normalizeAmount,
  parseInvoiceMemo,
  subtractAmounts,
} from '@finance-os/shared';
import type {
  ClientHistory,
  MatchableTransaction,
  MatchOptions,
  MatchResult,
  OpenInvoice,
} from './types.js';

const OPEN_STATUSES: ReadonlySet<string> = new Set(['sent', 'partially_paid', 'overdue']);
const DAY_MS = 86_400_000;

function outstanding(inv: OpenInvoice): string {
  return compareAmounts(inv.amountPaid, inv.amount) >= 0
    ? normalizeAmount('0')
    : subtractAmounts(inv.amount, inv.amountPaid);
}

/** Open = payable: sent / partially_paid / overdue with a positive balance. */
function isOpen(inv: OpenInvoice): boolean {
  return OPEN_STATUSES.has(inv.status) && compareAmounts(outstanding(inv), '0') > 0;
}

function sameAsset(tx: MatchableTransaction, inv: OpenInvoice): boolean {
  return tx.assetCode === inv.assetCode && (tx.assetIssuer ?? null) === (inv.assetIssuer ?? null);
}

function applyTo(
  tx: MatchableTransaction,
  inv: OpenInvoice,
  method: 'muxed' | 'memo',
): MatchResult {
  const due = outstanding(inv);
  const covers = compareAmounts(tx.amount, due) >= 0;
  const appliedAmount = covers ? due : normalizeAmount(tx.amount);
  return {
    kind: 'matched',
    invoiceId: inv.id,
    amount: normalizeAmount(tx.amount),
    appliedAmount,
    remaining: covers ? normalizeAmount('0') : subtractAmounts(due, tx.amount),
    newStatus: covers ? 'paid' : 'partially_paid',
    overpaidBy: covers ? subtractAmounts(tx.amount, due) : normalizeAmount('0'),
    method,
    confidence: 1,
  };
}

/**
 * Match one transaction to an open invoice. Pure: no I/O, no clock.
 *
 * Priority: muxed id → invoice memo → (no reference) scored suggestions.
 * A reference that cannot be matched is flagged, never guessed. Suggestions are
 * never returned as `matched` (README §5).
 */
export function matchTransaction(
  tx: MatchableTransaction,
  openInvoices: OpenInvoice[],
  history: ClientHistory,
  opts: MatchOptions = {},
): MatchResult {
  if (tx.direction !== 'in') return { kind: 'unmatched' };

  // 1/2. Deterministic reference. A muxed id wins over any memo, even a conflicting one.
  let ref: string | null = null;
  let method: 'muxed' | 'memo' = 'muxed';
  if (tx.muxedId) {
    ref = tx.muxedId;
  } else if (tx.memoType === 'text' && tx.memo) {
    const parsed = parseInvoiceMemo(tx.memo);
    if (parsed !== null) {
      ref = parsed.toString();
      method = 'memo';
    }
  }

  if (ref !== null) {
    const inv = openInvoices.find((i) => i.paymentRefId === ref);
    // Unknown, voided, draft or already-paid references are never matched.
    if (!inv || !isOpen(inv)) return { kind: 'flagged', reason: 'unknown_reference' };
    if (!sameAsset(tx, inv)) {
      return { kind: 'flagged', reason: 'wrong_asset', invoiceId: inv.id };
    }
    return applyTo(tx, inv, method);
  }

  // 3. No reference: score candidates; a human confirms.
  const windowMs = (opts.suggestionWindowDays ?? 14) * DAY_MS;
  const candidates: { invoiceId: string; score: number }[] = [];
  for (const inv of openInvoices) {
    if (!isOpen(inv) || !sameAsset(tx, inv)) continue;
    let score = 0;
    if (compareAmounts(tx.amount, outstanding(inv)) === 0) score += 0.5;
    if (history[inv.clientId]?.knownAddresses.includes(tx.from)) score += 0.3;
    if (Math.abs(tx.createdAt.getTime() - inv.dueDate.getTime()) <= windowMs) score += 0.2;
    if (score > 0) candidates.push({ invoiceId: inv.id, score: Math.round(score * 100) / 100 });
  }
  if (candidates.length === 0) return { kind: 'unmatched' };
  candidates.sort((a, b) => b.score - a.score || a.invoiceId.localeCompare(b.invoiceId));
  return { kind: 'suggested', candidates: candidates.slice(0, opts.maxSuggestions ?? 5) };
}
