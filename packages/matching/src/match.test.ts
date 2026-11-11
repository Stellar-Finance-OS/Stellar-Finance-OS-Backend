import { describe, expect, it } from 'vitest';
import { matchTransaction } from './match.js';
import type { MatchableTransaction, OpenInvoice } from './types.js';

const inv = (o: Partial<OpenInvoice> = {}): OpenInvoice => ({
  id: 'inv-1',
  clientId: 'c1',
  paymentRefId: '42',
  assetCode: 'USDC',
  assetIssuer: 'GISSUER',
  amount: '100',
  amountPaid: '0',
  status: 'sent',
  dueDate: new Date('2026-12-01T00:00:00Z'),
  ...o,
});
const tx = (o: Partial<MatchableTransaction> = {}): MatchableTransaction => ({
  id: 't1',
  direction: 'in',
  assetCode: 'USDC',
  assetIssuer: 'GISSUER',
  amount: '100',
  memoType: 'none',
  from: 'GSENDER',
  createdAt: new Date('2026-12-01T00:00:00Z'),
  ...o,
});

describe('matchTransaction', () => {
  it('matches an exact muxed payment', () => {
    expect(matchTransaction(tx({ muxedId: '42' }), [inv()], {})).toMatchObject({
      kind: 'matched',
      invoiceId: 'inv-1',
      method: 'muxed',
      confidence: 1,
      newStatus: 'paid',
      appliedAmount: '100.0000000',
      overpaidBy: '0.0000000',
    });
  });

  it('matches by memo, tolerating case and whitespace', () => {
    const r = matchTransaction(tx({ memoType: 'text', memo: ' inv42 ' }), [inv()], {});
    expect(r).toMatchObject({ kind: 'matched', method: 'memo' });
  });

  it('applies a partial payment', () => {
    expect(matchTransaction(tx({ muxedId: '42', amount: '30' }), [inv()], {})).toMatchObject({
      newStatus: 'partially_paid',
      appliedAmount: '30.0000000',
      remaining: '70.0000000',
    });
  });

  it('a second partial completes the invoice', () => {
    const r = matchTransaction(
      tx({ muxedId: '42', amount: '70' }),
      [inv({ amountPaid: '30', status: 'partially_paid' })],
      {},
    );
    expect(r).toMatchObject({ newStatus: 'paid', remaining: '0.0000000' });
  });

  it('applies and reports an overpayment', () => {
    expect(matchTransaction(tx({ muxedId: '42', amount: '125.5' }), [inv()], {})).toMatchObject({
      newStatus: 'paid',
      appliedAmount: '100.0000000',
      overpaidBy: '25.5000000',
    });
  });

  it('flags a wrong asset code and a wrong issuer, never matching', () => {
    expect(matchTransaction(tx({ muxedId: '42', assetCode: 'XLM' }), [inv()], {})).toEqual({
      kind: 'flagged',
      reason: 'wrong_asset',
      invoiceId: 'inv-1',
    });
    expect(
      matchTransaction(tx({ muxedId: '42', assetIssuer: 'GOTHER' }), [inv()], {}),
    ).toMatchObject({
      kind: 'flagged',
      reason: 'wrong_asset',
    });
  });

  it.each(['void', 'draft', 'paid'] as const)('flags a reference to a %s invoice', (status) => {
    expect(matchTransaction(tx({ muxedId: '42' }), [inv({ status })], {})).toEqual({
      kind: 'flagged',
      reason: 'unknown_reference',
    });
  });

  it('flags an unknown reference', () => {
    expect(matchTransaction(tx({ muxedId: '999' }), [inv()], {})).toMatchObject({
      reason: 'unknown_reference',
    });
  });

  it('ignores outgoing transactions', () => {
    expect(matchTransaction(tx({ direction: 'out', muxedId: '42' }), [inv()], {})).toEqual({
      kind: 'unmatched',
    });
  });

  it('muxed id wins over a conflicting memo', () => {
    const invoices = [inv(), inv({ id: 'inv-2', paymentRefId: '7' })];
    const r = matchTransaction(tx({ muxedId: '42', memoType: 'text', memo: 'INV7' }), invoices, {});
    expect(r).toMatchObject({ kind: 'matched', invoiceId: 'inv-1', method: 'muxed' });
  });

  it('suggests (never matches) when there is no reference', () => {
    const r = matchTransaction(tx(), [inv()], { c1: { knownAddresses: ['GSENDER'] } });
    expect(r).toEqual({ kind: 'suggested', candidates: [{ invoiceId: 'inv-1', score: 1 }] });
  });

  it('returns unmatched when nothing is plausible', () => {
    expect(matchTransaction(tx({ assetCode: 'XLM' }), [inv()], {})).toEqual({ kind: 'unmatched' });
    const far = tx({ amount: '5', createdAt: new Date('2025-01-01T00:00:00Z') });
    expect(matchTransaction(far, [inv()], {})).toEqual({ kind: 'unmatched' });
  });
});
