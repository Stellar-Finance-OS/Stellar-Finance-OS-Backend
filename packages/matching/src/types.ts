import type {
  InvoiceStatus,
  MatchMethod,
  MemoType,
  TransactionDirection,
} from '@finance-os/shared';

/** The slice of a Transaction the matcher needs. Amounts are decimal strings. */
export interface MatchableTransaction {
  id: string;
  direction: TransactionDirection;
  assetCode: string;
  assetIssuer?: string | null;
  amount: string;
  memo?: string | null;
  memoType: MemoType;
  /** uint64 muxed id as a decimal string. */
  muxedId?: string | null;
  from: string;
  createdAt: Date;
}

export interface OpenInvoice {
  id: string;
  clientId: string;
  /** uint64 payment reference as a decimal string (Invoice.paymentRefId). */
  paymentRefId: string;
  assetCode: string;
  assetIssuer?: string | null;
  amount: string;
  amountPaid: string;
  status: InvoiceStatus;
  dueDate: Date;
}

export type ClientHistory = Record<string, { knownAddresses: string[] }>;

export interface MatchOptions {
  /** Max distance in days between payment time and invoice due date for a suggestion. Default 14. */
  suggestionWindowDays?: number;
  /** Max suggestions returned. Default 5. */
  maxSuggestions?: number;
}

/** Result of matching one transaction. Pure data — produced without I/O. */
export type MatchResult =
  | {
      kind: 'matched';
      invoiceId: string;
      /** Full transaction amount. */
      amount: string;
      /** Amount credited to the invoice (capped at what was outstanding). */
      appliedAmount: string;
      /** Invoice balance still outstanding after this payment. */
      remaining: string;
      newStatus: 'partially_paid' | 'paid';
      /**
       * Excess over the outstanding balance, "0.0000000" when none. Overpayments are
       * applied (invoice → paid) and carry a non-zero overpaidBy so callers can flag them.
       */
      overpaidBy: string;
      method: MatchMethod;
      confidence: number;
    }
  | { kind: 'suggested'; candidates: { invoiceId: string; score: number }[] }
  | {
      kind: 'flagged';
      reason: 'wrong_asset' | 'overpayment' | 'unknown_reference';
      invoiceId?: string;
    }
  | { kind: 'unmatched' };
