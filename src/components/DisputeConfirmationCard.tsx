import { CheckCircle2, ShieldAlert, XCircle, Loader2 } from 'lucide-react';
import type { PendingDisputeConfirmation } from '../types/banking';
import { formatINR, formatTimeShort } from '../utils/format';

interface DisputeConfirmationCardProps {
  confirmation: PendingDisputeConfirmation;
  isSubmitting: boolean;
  onConfirm: (confirmation: PendingDisputeConfirmation) => void;
  onCancel: (confirmationId: string) => void;
}

export function DisputeConfirmationCard({
  confirmation,
  isSubmitting,
  onConfirm,
  onCancel,
}: DisputeConfirmationCardProps) {
  const isPending = confirmation.state === 'PENDING_USER_ACTION';
  const isConfirmed = confirmation.state === 'CONFIRMED';
  const isCancelled = confirmation.state === 'CANCELLED';

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white overflow-hidden">
      {/* Header Strip */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50/80">
        <div className="flex items-center gap-2 min-w-0">
          {isPending && <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />}
          {isConfirmed && <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />}
          {isCancelled && <XCircle className="w-4 h-4 text-slate-500 shrink-0" />}
          <span className="font-display text-sm font-semibold text-slate-900 truncate">
            {isPending && 'Card Dispute Approval Required'}
            {isConfirmed && 'Dispute Submitted to Core Banking'}
            {isCancelled && 'Dispute Request Cancelled'}
          </span>
        </div>

        <span
          className={`font-mono text-[11px] font-medium px-2 py-0.5 rounded-sm border whitespace-nowrap shrink-0 ${
            isPending
              ? 'bg-amber-50 text-amber-800 border-amber-200'
              : isConfirmed
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-slate-100 text-slate-600 border-slate-200'
          }`}
        >
          {isPending && 'WRITE · HITL GATE'}
          {isConfirmed && `CONFIRMED · ${confirmation.dispute_id ?? 'FILED'}`}
          {isCancelled && 'CANCELLED'}
        </span>
      </div>

      {/* Transaction Ledger Summary */}
      <div className="px-4 py-3.5 space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">{confirmation.merchant}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              <span>{confirmation.category}</span>
              <span aria-hidden="true" className="mx-1.5">
                ·
              </span>
              <span>{confirmation.date}</span>
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="font-mono text-base font-semibold text-slate-900 tabular-nums">
              {formatINR(confirmation.amount)}
            </p>
            <p className="font-mono text-[11px] text-emerald-700 font-medium">
              {confirmation.status}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 pt-3 border-t border-slate-100 text-xs">
          <div>
            <span className="text-slate-500">Transaction ID</span>
            <p className="font-mono font-medium text-slate-800 mt-0.5 tabular-nums">
              {confirmation.transaction_id}
            </p>
          </div>
          <div>
            <span className="text-slate-500">Settlement Reference</span>
            <p className="font-mono font-medium text-slate-800 mt-0.5 tabular-nums">
              {confirmation.reference_id}
            </p>
          </div>
          <div className="sm:col-span-2">
            <span className="text-slate-500">Dispute Reason</span>
            <p className="text-slate-800 mt-0.5">{confirmation.reason}</p>
          </div>
        </div>

        {/* Action Row */}
        {isPending && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
            <p className="text-xs text-slate-500">
              Backend policy requires explicit cardholder authorization before writing.
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => onCancel(confirmation.confirmationId)}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => onConfirm(confirmation)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Submitting...</span>
                  </>
                ) : (
                  <span>Confirm &amp; Submit Dispute</span>
                )}
              </button>
            </div>
          </div>
        )}

        {isConfirmed && (
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs text-emerald-800">
            <span>
              Authorized via HITL Gate · Reference{' '}
              <span className="font-mono font-semibold">{confirmation.dispute_id}</span>
            </span>
            {confirmation.confirmed_at && (
              <span className="font-mono text-slate-500 tabular-nums">
                {formatTimeShort(confirmation.confirmed_at)}
              </span>
            )}
          </div>
        )}

        {isCancelled && (
          <div className="pt-3 border-t border-slate-100 text-xs text-slate-500">
            No write operation was executed. Your ledger remains unchanged.
          </div>
        )}
      </div>
    </div>
  );
}
