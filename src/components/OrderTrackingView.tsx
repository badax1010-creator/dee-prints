import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  PackageCheck,
  Search,
  XCircle,
} from 'lucide-react';
import { ORDER_TRACKING_STAGES, OrderStatus } from '../types';

interface OrderTrackingViewProps {
  initialRef?: string;
  onBackHome: () => void;
}

interface TrackedOrderSummary {
  orderId: string;
  status: OrderStatus;
  submissionMode: string;
  documentCount: number;
  totalPages: number;
  copies: number;
  sides: string;
  printType: string;
  finishing: string;
  selectedServiceNames: string[];
  deliveryMethod: string;
  pricingSummary: {
    currency: string;
    printingCost: number;
    packagingCost: number;
    deliveryFee: number;
    additionalServicesCost: number;
    additionalCharges: number;
    total: number;
  };
  quotation: {
    summary: string;
    quotedBy: string;
    quotedAt: string;
    totalAmount: number;
    currency: string;
  } | null;
  paymentStatus: string;
  paymentMethod: string;
  whatsappLinked: boolean;
  createdAt: string;
  updatedAt: string;
}

export const OrderTrackingView: React.FC<OrderTrackingViewProps> = ({
  initialRef = '',
  onBackHome,
}) => {
  const [queryRef, setQueryRef] = useState(() => {
    if (initialRef) return initialRef;
    const params = new URLSearchParams(window.location.search);
    return (params.get('ref') || '').toUpperCase();
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracked, setTracked] = useState<TrackedOrderSummary | null>(null);

  const performLookup = async (rawRef: string) => {
    const cleanRef = rawRef.trim().toUpperCase();
    if (!cleanRef) {
      setError('Enter your DEE PRINTS order reference (e.g. DEE-A1B2C3).');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/track/${encodeURIComponent(cleanRef)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not locate order.');
      }
      setTracked(data as TrackedOrderSummary);
      const url = new URL(window.location.href);
      url.searchParams.set('ref', cleanRef);
      window.history.replaceState({}, '', url.pathname + url.search);
    } catch (err) {
      setTracked(null);
      setError(err instanceof Error ? err.message : 'Unable to fetch order status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (queryRef) {
      void performLookup(queryRef);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void performLookup(queryRef);
  };

  const currentStageIdx = tracked
    ? ORDER_TRACKING_STAGES.findIndex((s) => s.status === tracked.status)
    : -1;

  return (
    <main className="max-w-[920px] mx-auto px-6 py-12">
      <button
        type="button"
        onClick={onBackHome}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[#57544E] hover:text-[#141413] transition-colors mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to DEE PRINTS Studio
      </button>

      <div className="rounded-xl border border-[#E5E3DE] bg-white p-6 sm:p-8 shadow-xs">
        <p className="text-xs font-mono text-[#6B6760] uppercase tracking-wider">
          Live Order Progress &amp; Quotation
        </p>
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#141413] mt-1">
          Track Your Printing Order
        </h1>
        <p className="text-sm text-[#57544E] mt-1.5">
          Enter your unique tracking reference (<span className="font-mono">DEE-XXXXXX</span>) from your upload confirmation or WhatsApp chat to view your order stage and quotation.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#6B6760] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={queryRef}
              onChange={(e) => setQueryRef(e.target.value.toUpperCase())}
              placeholder="Enter Order Reference (e.g., DEE-A1B2C3)"
              aria-label="Order reference"
              className="w-full rounded-lg border border-[#D4D0C8] bg-white pl-10 pr-4 py-3 text-sm font-mono uppercase text-[#141413] placeholder:normal-case placeholder:font-sans placeholder:text-[#8A857C] focus:border-[#141413] focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-[#C8232C] rounded-lg hover:bg-[#AE1D25] disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
            Check Order Status
          </button>
        </form>

        {error && (
          <div
            role="alert"
            className="mt-5 rounded-lg border border-[#C8232C]/30 bg-[#C8232C]/5 px-4 py-3 text-sm text-[#C8232C] flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {tracked && (
          <div className="mt-8 space-y-8 border-t border-[#E5E3DE] pt-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-mono text-[#6B6760]">ORDER REFERENCE</p>
                <h2 className="font-mono text-2xl font-bold text-[#141413] mt-0.5">
                  {tracked.orderId}
                </h2>
                <p className="text-xs text-[#57544E] mt-1">
                  Updated {new Date(tracked.updatedAt).toLocaleString()} ·{' '}
                  {tracked.documentCount} {tracked.documentCount === 1 ? 'document' : 'documents'} ·{' '}
                  {tracked.totalPages} {tracked.totalPages === 1 ? 'page' : 'pages'} ·{' '}
                  {tracked.copies} {tracked.copies === 1 ? 'copy' : 'copies'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={`/api/dispatch/whatsapp/${encodeURIComponent(tracked.orderId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#141413] rounded-lg hover:bg-[#2C2A27] transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Continue on WhatsApp
                </a>
              </div>
            </div>

            {/* 7-Stage Status Timeline */}
            {tracked.status === 'CANCELLED' ? (
              <div className="rounded-xl border border-[#C8232C]/30 bg-[#C8232C]/5 p-5 flex items-start gap-3">
                <XCircle className="w-5 h-5 text-[#C8232C] shrink-0 mt-0.5" />
                <div>
                  <p className="font-display text-base font-bold text-[#141413]">Order Cancelled</p>
                  <p className="text-sm text-[#57544E] mt-0.5">
                    This order has been cancelled. Message DEE PRINTS on WhatsApp if you need assistance placing a new order.
                  </p>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-xs font-mono text-[#6B6760] uppercase mb-4">
                  Fulfillment Progress
                </p>
                <ol className="space-y-3">
                  {ORDER_TRACKING_STAGES.map((stage, idx) => {
                    const isCompleted = currentStageIdx > idx;
                    const isCurrent = currentStageIdx === idx;
                    return (
                      <li
                        key={stage.status}
                        className={`rounded-xl border p-4 flex items-start gap-3.5 transition-colors ${
                          isCurrent
                            ? 'border-[#141413] bg-[#FAF9F7]'
                            : isCompleted
                              ? 'border-emerald-200 bg-emerald-50/40'
                              : 'border-[#E5E3DE] bg-white opacity-70'
                        }`}
                      >
                        <div className="mt-0.5 shrink-0">
                          {isCompleted || (isCurrent && stage.status === 'SUCCESSFULLY DELIVERED') ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                          ) : isCurrent ? (
                            <Clock className="w-5 h-5 text-[#C8232C]" />
                          ) : (
                            <span className="w-5 h-5 rounded-full border-2 border-[#D4D0C8] block" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-display text-sm font-semibold text-[#141413]">
                              {stage.label}
                            </p>
                            {isCurrent && (
                              <span className="font-mono text-[11px] font-semibold text-[#C8232C]">
                                CURRENT STAGE
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[#57544E] mt-0.5">{stage.description}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

            {/* Quotation & Price Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="rounded-xl border border-[#E5E3DE] bg-[#FAF9F7] p-5">
                <p className="text-xs font-mono text-[#6B6760] uppercase mb-3">
                  Quotation &amp; Price Breakdown
                </p>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-[#57544E]">Printing Cost</dt>
                    <dd className="font-mono tabular-nums text-[#141413]">
                      {tracked.pricingSummary.currency}{' '}
                      {tracked.pricingSummary.printingCost.toLocaleString()}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[#57544E]">Packaging (Envelopes &amp; Binding)</dt>
                    <dd className="font-mono tabular-nums text-[#141413]">
                      {tracked.pricingSummary.currency}{' '}
                      {tracked.pricingSummary.packagingCost.toLocaleString()}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[#57544E]">Additional Services</dt>
                    <dd className="font-mono tabular-nums text-[#141413]">
                      {tracked.pricingSummary.currency}{' '}
                      {(
                        tracked.pricingSummary.additionalServicesCost +
                        tracked.pricingSummary.additionalCharges
                      ).toLocaleString()}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[#57544E]">Delivery Fee</dt>
                    <dd className="font-mono tabular-nums text-[#141413]">
                      {tracked.pricingSummary.currency}{' '}
                      {tracked.pricingSummary.deliveryFee.toLocaleString()}
                    </dd>
                  </div>
                  <div className="pt-2 border-t border-[#E5E3DE] flex justify-between font-bold text-[#141413]">
                    <dt>Total Order Cost</dt>
                    <dd className="font-mono text-base tabular-nums">
                      {tracked.pricingSummary.currency}{' '}
                      {tracked.pricingSummary.total.toLocaleString()}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-xl border border-[#E5E3DE] bg-white p-5 space-y-3">
                <p className="text-xs font-mono text-[#6B6760] uppercase">
                  Order Details &amp; Payment
                </p>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-[#57544E]">Payment Method</dt>
                    <dd className="font-medium text-[#141413] text-right">
                      {tracked.paymentMethod} ({tracked.paymentStatus})
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-[#57544E]">Print Mode</dt>
                    <dd className="font-medium text-[#141413] text-right">
                      {tracked.printType.toUpperCase()} · {tracked.sides} · {tracked.finishing}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-[#57544E]">Collection / Delivery</dt>
                    <dd className="font-medium text-[#141413] text-right">
                      {tracked.deliveryMethod === 'campus_delivery'
                        ? 'Campus Delivery'
                        : 'Print Shop Pickup'}
                    </dd>
                  </div>
                  {tracked.selectedServiceNames.length > 0 && (
                    <div>
                      <dt className="text-[#57544E] text-xs mb-1">Selected Services</dt>
                      <dd className="text-xs text-[#141413]">
                        {tracked.selectedServiceNames.join(' · ')}
                      </dd>
                    </div>
                  )}
                </dl>
                {tracked.quotation && (
                  <div className="pt-3 border-t border-[#ECEAE4]">
                    <p className="text-[11px] font-mono text-[#6B6760] uppercase">
                      Quotation Note ({tracked.quotation.quotedBy})
                    </p>
                    <p className="text-xs text-[#141413] whitespace-pre-line mt-1">
                      {tracked.quotation.summary}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
};
