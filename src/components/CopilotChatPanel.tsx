import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, ShieldX } from 'lucide-react';
import type {
  ChatMessage,
  CustomerProfile,
  PendingDisputeConfirmation,
} from '../types/banking';
import { formatTimeShort, parseInlineMarkdown } from '../utils/format';
import { DisputeConfirmationCard } from './DisputeConfirmationCard';

interface CopilotChatPanelProps {
  profile: CustomerProfile | null;
  activeDisputeCount: number;
  messages: ChatMessage[];
  isSending: boolean;
  confirmingId: string | null;
  onSendMessage: (text: string) => void;
  onConfirmDispute: (confirmation: PendingDisputeConfirmation) => void;
  onCancelDispute: (confirmationId: string) => void;
}

const QUICK_PROMPTS = [
  'Why was I charged twice at Zomato?',
  'Dispute my Uber charge',
  'Check my balance & recent spend',
];

function FormattedMessageBody({ content }: { content: string }) {
  const lines = content.split('\n');

  return (
    <div className="space-y-2 text-[14.5px] leading-relaxed text-slate-800">
      {lines.map((rawLine, idx) => {
        const trimmed = rawLine.trim();
        if (!trimmed) {
          return <div key={idx} className="h-1" />;
        }

        const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ');
        const cleanLine = isBullet ? trimmed.slice(2) : rawLine;
        const segments = parseInlineMarkdown(cleanLine);

        const rendered = segments.map((seg, segIdx) => {
          if (seg.type === 'bold') {
            return (
              <strong key={segIdx} className="font-semibold text-slate-950">
                {seg.value}
              </strong>
            );
          }
          if (seg.type === 'code') {
            return (
              <code
                key={segIdx}
                className="font-mono text-[12.5px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-900 border border-slate-200/80"
              >
                {seg.value}
              </code>
            );
          }
          return <span key={segIdx}>{seg.value}</span>;
        });

        if (isBullet) {
          return (
            <div key={idx} className="flex items-start gap-2.5 pl-1">
              <span className="text-slate-400 select-none mt-0.5">•</span>
              <p className="flex-1">{rendered}</p>
            </div>
          );
        }

        return <p key={idx}>{rendered}</p>;
      })}
    </div>
  );
}

export function CopilotChatPanel({
  profile,
  activeDisputeCount,
  messages,
  isSending,
  confirmingId,
  onSendMessage,
  onConfirmDispute,
  onCancelDispute,
}: CopilotChatPanelProps) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isSending) return;
    setInput('');
    onSendMessage(trimmed);
  };

  return (
    <section className="flex flex-col h-full bg-[#F8F9FB] border-r border-slate-200 min-w-0">
      {/* Executive Account Summary Strip */}
      <div className="px-6 py-4 bg-white border-b border-slate-200 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              {profile ? profile.name : 'Loading account...'}
            </h2>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-0.5">
              <span>{profile?.account_type ?? 'Savings Account'}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-700 tabular-nums">
                {profile?.account_masked ?? '•••• 4821'}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {profile ? `${profile.card_tier} •••• ${profile.card_last4}` : 'Signature Debit'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-6 shrink-0">
            <div className="text-right">
              <p className="text-xs text-slate-500">Available Balance</p>
              <p className="font-mono text-lg font-semibold text-slate-950 tabular-nums tracking-tight">
                {profile?.formatted_balance ?? '₹84,500'}
              </p>
            </div>
            <div className="h-8 w-px bg-slate-200 hidden sm:block" aria-hidden="true" />
            <div className="text-right hidden sm:block">
              <p className="text-xs text-slate-500">Open Disputes</p>
              <p className="font-mono text-lg font-semibold text-slate-950 tabular-nums">
                {activeDisputeCount}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Chat Conversation Stream */}
      <div className="flex-1 overflow-y-auto custom-scroll px-6 py-6 space-y-6">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
            >
              {/* Quiet metadata line */}
              <div className="flex items-center gap-2 text-xs text-slate-500 mb-1.5 px-0.5">
                <span className="font-medium text-slate-700">
                  {isUser ? profile?.name ?? 'Ananya Sharma' : 'Banking Copilot'}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{formatTimeShort(msg.timestamp)}</span>
                {!isUser && msg.toolNamesUsed && msg.toolNamesUsed.length > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-slate-600">
                      {msg.toolNamesUsed.join(', ')}
                    </span>
                  </>
                )}
              </div>

              {/* Message Surface */}
              {isUser ? (
                <div className="max-w-[85%] rounded-lg bg-slate-900 text-white px-4 py-3 text-[14.5px] leading-relaxed">
                  {msg.content}
                </div>
              ) : (
                <div className="w-full max-w-[94%] rounded-lg bg-white border border-slate-200 px-5 py-4">
                  <FormattedMessageBody content={msg.content} />

                  {/* Policy Rejection Callout when ERR_PENDING_TXN occurs */}
                  {msg.errorBanner && (
                    <div className="mt-3.5 rounded-md border border-red-200 bg-red-50/70 px-3.5 py-2.5 flex items-start gap-2.5">
                      <ShieldX className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                      <div className="text-xs leading-relaxed">
                        <p className="font-mono font-semibold text-red-800">
                          {msg.errorBanner.code}
                        </p>
                        <p className="text-red-700 mt-0.5">{msg.errorBanner.message}</p>
                      </div>
                    </div>
                  )}

                  {/* Interactive HITL Confirmation Card */}
                  {msg.pendingConfirmation && (
                    <DisputeConfirmationCard
                      confirmation={msg.pendingConfirmation}
                      isSubmitting={confirmingId === msg.pendingConfirmation.confirmationId}
                      onConfirm={onConfirmDispute}
                      onCancel={onCancelDispute}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}

        {isSending && (
          <div className="flex flex-col items-start">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1.5 px-0.5">
              <span className="font-medium text-slate-700">Banking Copilot</span>
              <span aria-hidden="true">·</span>
              <span>Querying Core Banking MCP tools</span>
            </div>
            <div className="inline-flex items-center gap-2.5 rounded-lg bg-white border border-slate-200 px-4 py-3 text-sm text-slate-600">
              <Loader2 className="w-4 h-4 animate-spin text-blue-700" />
              <span>Evaluating ledger and banking policies...</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Quick-Test Prompt Controls + Input Composer */}
      <div className="px-6 py-4 bg-white border-t border-slate-200 shrink-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {QUICK_PROMPTS.map((promptText) => (
            <button
              key={promptText}
              type="button"
              disabled={isSending}
              onClick={() => onSendMessage(promptText)}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100 hover:border-slate-300 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {promptText}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex items-center gap-2.5">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isSending}
            placeholder="Ask about your balance, recent charges, or initiate a card dispute..."
            aria-label="Message Engagement Banking Copilot"
            className="flex-1 h-11 px-4 text-sm text-slate-900 placeholder:text-slate-400 bg-[#F8F9FB] border border-slate-300 rounded-lg focus:outline-none focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15 transition-all"
          />
          <button
            type="submit"
            disabled={isSending || !input.trim()}
            aria-label="Send message"
            className="h-11 px-4 inline-flex items-center justify-center gap-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Send</span>
            <ArrowUp className="w-4 h-4" />
          </button>
        </form>
      </div>
    </section>
  );
}
