import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  CustomerProfile,
  DisputeRecord,
  McpAuditEvent,
  Transaction,
} from '../src/types/banking.ts';

export interface CoreBankingStore {
  profile: CustomerProfile;
  transactions: Transaction[];
  disputes: DisputeRecord[];
  auditEvents: McpAuditEvent[];
}

const STATE_DIR = process.env.VERCEL ? os.tmpdir() : process.cwd();
const STATE_FILE_PATH = path.resolve(STATE_DIR, '.banking-session-state.json');

export function formatINR(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

export function createInitialState(): CoreBankingStore {
  return {
    profile: {
      customer_id: 'CUST-994821',
      name: 'Ananya Sharma',
      account_type: 'Savings Account',
      account_last4: '4821',
      account_masked: '•••• 4821',
      ifsc: 'EBCN0000482',
      card_last4: '9104',
      card_tier: 'Signature Debit',
      currency: 'INR',
      balance: 84500,
      formatted_balance: formatINR(84500),
    },
    transactions: [
      {
        id: 'TXN-106',
        date: 'Today, 11:30 AM',
        merchant: 'Apollo Pharmacy',
        amount: 1250,
        type: 'DEBIT',
        status: 'POSTED',
        category: 'Healthcare',
        reference_id: 'UTR904821736106',
      },
      {
        id: 'TXN-103',
        date: 'Today, 10:30 AM',
        merchant: 'Uber India',
        amount: 640,
        type: 'DEBIT',
        status: 'PENDING',
        category: 'Transport & Mobility',
        reference_id: 'AUTH773910482103',
        notes: 'Pending card authorization hold',
      },
      {
        id: 'TXN-102',
        date: 'Yesterday, 8:16 PM',
        merchant: 'Zomato',
        amount: 4500,
        type: 'DEBIT',
        status: 'POSTED',
        category: 'Dining & Delivery',
        reference_id: 'UTR904821736102',
        notes: 'Duplicate charge #2 (60 seconds after TXN-101)',
      },
      {
        id: 'TXN-101',
        date: 'Yesterday, 8:15 PM',
        merchant: 'Zomato',
        amount: 4500,
        type: 'DEBIT',
        status: 'POSTED',
        category: 'Dining & Delivery',
        reference_id: 'UTR904821736101',
        notes: 'Duplicate charge #1',
      },
      {
        id: 'TXN-104',
        date: '3 days ago',
        merchant: 'Apollo Pharmacy',
        amount: 1250,
        type: 'DEBIT',
        status: 'POSTED',
        category: 'Healthcare',
        reference_id: 'UTR904821736104',
      },
      {
        id: 'TXN-105',
        date: '1st of month',
        merchant: 'Salary Credit - TechCorp',
        amount: 145000,
        type: 'CREDIT',
        status: 'POSTED',
        category: 'Income',
        reference_id: 'NEFT882100459105',
      },
    ],
    disputes: [],
    auditEvents: [],
  };
}

function loadStore(): CoreBankingStore {
  const initial = createInitialState();
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      const raw = fs.readFileSync(STATE_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as CoreBankingStore;
      if (parsed?.profile && Array.isArray(parsed?.transactions)) {
        const existingIds = new Set(parsed.transactions.map((t) => t.id.toUpperCase()));
        const missingSeedTxns = initial.transactions.filter(
          (t) => !existingIds.has(t.id.toUpperCase())
        );
        if (missingSeedTxns.length > 0) {
          parsed.transactions = [...missingSeedTxns, ...parsed.transactions];
          persistStore(parsed);
        }
        return parsed;
      }
    }
  } catch {
    // Fall back to fresh initial banking dataset if local JSON is unreadable.
  }
  persistStore(initial);
  return initial;
}

function persistStore(state: CoreBankingStore): void {
  try {
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // In-memory state remains authoritative even if filesystem write fails.
  }
}

let store: CoreBankingStore = loadStore();

export function getProfile(): CustomerProfile {
  return { ...store.profile };
}

export function getTransactions(limit?: number): Transaction[] {
  const ordered = store.transactions.map((txn) => ({ ...txn }));
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    return ordered.slice(0, Math.floor(limit));
  }
  return ordered;
}

export function findTransactionById(transactionId: string): Transaction | undefined {
  const normalized = transactionId.trim().toUpperCase();
  return store.transactions.find((txn) => txn.id.toUpperCase() === normalized);
}

export function getDisputes(): DisputeRecord[] {
  return store.disputes.map((d) => ({ ...d }));
}

export function getAuditEvents(): McpAuditEvent[] {
  return store.auditEvents.map((evt) => ({ ...evt }));
}

export function recordAuditEvent(event: McpAuditEvent): void {
  store.auditEvents = [event, ...store.auditEvents].slice(0, 60);
  persistStore(store);
}

export function createDisputeRecord(transactionId: string, reason: string): DisputeRecord {
  const txn = findTransactionById(transactionId);
  if (!txn) {
    throw new Error(`Transaction ${transactionId} not found`);
  }

  const disputeNumber = 4081 + store.disputes.length;
  const disputeId = `DSP-${disputeNumber}`;
  const record: DisputeRecord = {
    dispute_id: disputeId,
    transaction_id: txn.id,
    merchant: txn.merchant,
    amount: txn.amount,
    reference_id: txn.reference_id,
    reason: reason.trim() || 'Duplicate or unauthorized card charge',
    status: 'SUBMITTED',
    created_at: new Date().toISOString(),
    provisional_credit_eta: '2–3 business days',
  };

  txn.dispute_id = disputeId;
  txn.dispute_status = 'SUBMITTED';
  store.disputes = [record, ...store.disputes];
  persistStore(store);
  return { ...record };
}

export function resetBankingStore(): CoreBankingStore {
  store = createInitialState();
  persistStore(store);
  return {
    profile: getProfile(),
    transactions: getTransactions(),
    disputes: getDisputes(),
    auditEvents: getAuditEvents(),
  };
}
