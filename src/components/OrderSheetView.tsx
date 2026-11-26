import React, { useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy, Download, FileText, Lock, Printer } from 'lucide-react';
import { buildEnvelopeLabelHtml } from '../envelopeHtml';
import { auth, isAuthorizedAdminUser, signInAdminWithGoogle, subscribeToAuth } from '../firebase';
import { FINISHING_OPTIONS, normalizeOrderStatus, PAYMENT_OPTIONS, PrintOrderRecord } from '../types';
import { EnvelopePreview } from './EnvelopePreview';

interface OrderSheetViewProps {
  orderId: string;
  onBackHome: () => void;
  onOpenTrack?: (orderId: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const OrderSheetView: React.FC<OrderSheetViewProps> = ({
  orderId,
  onBackHome,
  onOpenTrack,
}) => {
  const [order, setOrder] = useState<PrintOrderRecord | null>(null);
  const [whatsappText, setWhatsappText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsAdminSignIn, setNeedsAdminSignIn] = useState(false);
  const [copied, setCopied] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    return subscribeToAuth((user) => {
      setIsAdmin(isAuthorizedAdminUser(user));
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    if (!authReady) return;
    let active = true;
    setLoading(true);
    setError(null);
    setNeedsAdminSignIn(false);

    const loadOrder = async () => {
      try {
        const search = window.location.search;
        const params = new URLSearchParams(search);
        const exp = params.get('exp');
        const sig = params.get('sig');

        const querySuffix =
          exp && sig ? `?exp=${encodeURIComponent(exp)}&sig=${encodeURIComponent(sig)}` : '';

        const headers: Record<string, string> = {};
        if (auth.currentUser && isAuthorizedAdminUser(auth.currentUser)) {
          const token = await auth.currentUser.getIdToken();
          headers.Authorization = `Bearer ${token}`;
        }

        const localRaw = sessionStorage.getItem(`dee_order_${orderId}`);
        const localOrder = localRaw ? (JSON.parse(localRaw) as PrintOrderRecord) : null;

        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}${querySuffix}`, {
          headers,
        });
        const isJson = res.headers.get('content-type')?.includes('application/json');

        if ((res.status === 401 || res.status === 403) && !localOrder) {
          if (active) {
            setNeedsAdminSignIn(true);
            setError('This print job sheet is private. Sign in as administrator or open the signed order receipt link.');
            setLoading(false);
          }
          return;
        }
        if (res.ok && isJson) {
          const data = (await res.json()) as {
            order: PrintOrderRecord;
            whatsappMessageText: string;
          };
          if (active) {
            setOrder(data.order);
            setWhatsappText(data.whatsappMessageText || '');
            setLoading(false);
          }
          return;
        }
        if (localOrder) {
          if (active) {
            setOrder(localOrder);
            setWhatsappText(
              `Order Reference: ${localOrder.orderId}\nStudent: ${localOrder.customer.fullName}\nTotal: ${localOrder.pricing.currency} ${localOrder.pricing.total}`,
            );
            setLoading(false);
          }
          return;
        }
        const errData = isJson ? await res.json().catch(() => ({})) : {};
        throw new Error(errData.error || 'Could not load this assignment order.');
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to load order.');
          setLoading(false);
        }
      }
    };

    void loadOrder();
    return () => {
      active = false;
    };
  }, [orderId, authReady, isAdmin]);

  const handleCopySummary = async () => {
    if (!whatsappText) return;
    try {
      await navigator.clipboard.writeText(whatsappText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked
    }
  };

  if (loading) {
    return (
      <main className="max-w-[1040px] mx-auto px-6 py-16">
        <div className="rounded-xl border border-[#E5E3DE] bg-white p-10 text-center">
          <p className="text-sm text-[#57544E]">Loading assignment order {orderId}...</p>
        </div>
      </main>
    );
  }

  if (error || !order) {
    return (
      <main className="max-w-[1040px] mx-auto px-6 py-16">
        <div className="rounded-xl border border-[#E5E3DE] bg-white p-10 max-w-xl mx-auto">
          <div className="w-10 h-10 rounded-lg bg-[#F3F1EC] flex items-center justify-center mb-4">
            <Lock className="w-5 h-5 text-[#141413]" />
          </div>
          <h1 className="font-display text-2xl font-bold text-[#141413]">
            Order Sheet Protected
          </h1>
          <p className="mt-2 text-sm text-[#57544E]">
            {error || 'This order record could not be found.'}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {needsAdminSignIn && (
              <button
                type="button"
                onClick={() => void signInAdminWithGoogle()}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#C8232C] rounded-lg hover:bg-[#AE1D25] transition-colors"
              >
                Sign in with Administrator Google
              </button>
            )}
            <button
              type="button"
              onClick={onBackHome}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#141413] rounded-lg hover:bg-[#2C2A27] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Return to Print Studio
            </button>
          </div>
        </div>
      </main>
    );
  }

  const finishingLabel =
    FINISHING_OPTIONS.find((b) => b.id === order.printing.finishing)?.label ||
    order.printing.finishing;
  const paymentLabel =
    PAYMENT_OPTIONS.find((p) => p.id === order.payment.method)?.label ||
    order.payment.method;
  const documents =
    order.documents && order.documents.length > 0
      ? order.documents
      : [
          {
            fileId: 'primary',
            filename: order.document.filename,
            mimeType: 'application/pdf',
            extension: 'pdf' as const,
            pages: order.document.pages,
            sizeBytes: order.document.sizeBytes,
            storagePath: order.document.storagePath,
            secureDownloadUrl: order.document.secureDownloadUrl,
          },
        ];

  return (
    <main className="max-w-[1120px] mx-auto px-6 py-10">
      <div className="no-print flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-[#E5E3DE]">
        <div>
          <button
            type="button"
            onClick={onBackHome}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#57544E] hover:text-[#141413] transition-colors mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to DEE PRINTS
          </button>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#141413]">
            Order Receipt &amp; Envelope · <span className="font-mono">{order.orderId}</span>
          </h1>
          <p className="mt-1 text-sm text-[#57544E]">
            Status: <span className="font-semibold text-[#141413]">{normalizeOrderStatus(order.status)}</span> · Submitted{' '}
            {new Date(order.createdAt).toLocaleString()}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {onOpenTrack && (
            <button
              type="button"
              onClick={() => onOpenTrack(order.orderId)}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#C8232C] rounded-lg hover:bg-[#AE1D25] transition-colors whitespace-nowrap shrink-0"
            >
              Track Order Status
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-[#D4D0C8] bg-white text-[#141413] rounded-lg hover:bg-[#F3F1EC] transition-colors whitespace-nowrap shrink-0"
          >
            <Printer className="w-4 h-4" />
            Print Envelope Label
          </button>
          <button
            type="button"
            onClick={handleCopySummary}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-[#D4D0C8] bg-white text-[#141413] rounded-lg hover:bg-[#F3F1EC] transition-colors whitespace-nowrap shrink-0"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-700" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy Order Text'}
          </button>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <section className="no-print lg:col-span-7 space-y-6">
          <div className="rounded-xl border border-[#E5E3DE] bg-white p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ECEAE4] pb-3">
              <p className="text-xs font-mono text-[#6B6760] uppercase">
                Uploaded Documents ({documents.length})
              </p>
              <button
                type="button"
                onClick={() => {
                  const html = buildEnvelopeLabelHtml({
                    orderId: order.orderId,
                    customer: order.customer,
                    copies: order.printing.copies,
                    finishingLabel,
                    envelopeQuantity: order.printing.envelopeQuantity,
                    note: order.envelopeLabel?.note,
                  });
                  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `DEE-PRINTS-Label-${order.orderId}.html`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  setTimeout(() => URL.revokeObjectURL(url), 1500);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#141413] border border-[#D4D0C8] rounded-md hover:bg-[#F3F1EC] transition-colors"
              >
                Download Label HTML
              </button>
            </div>
            {documents.map((docItem) => {
              const isFirebaseUrl = /^https:\/\/firebasestorage\.googleapis\.com/i.test(
                docItem.secureDownloadUrl,
              );
              const downloadHref = isFirebaseUrl
                ? docItem.secureDownloadUrl
                : `${docItem.secureDownloadUrl}${docItem.secureDownloadUrl.includes('?') ? '&' : '?'}download=1`;
              return (
                <div
                  key={docItem.fileId}
                  className="flex flex-wrap items-center justify-between gap-3 py-2 border-b border-[#F3F1EC] last:border-b-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-[#F3F1EC] flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-[#141413]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#141413] truncate">
                        {docItem.filename}
                      </p>
                      <p className="text-xs font-mono text-[#6B6760] tabular-nums">
                        {docItem.extension.toUpperCase()} · {docItem.pages}{' '}
                        {docItem.pages === 1 ? 'page' : 'pages'} · {formatBytes(docItem.sizeBytes)}
                      </p>
                    </div>
                  </div>
                  <a
                    href={downloadHref}
                    target={isFirebaseUrl ? '_blank' : undefined}
                    rel={isFirebaseUrl ? 'noopener noreferrer' : undefined}
                    download={isFirebaseUrl ? undefined : docItem.filename}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#141413] rounded-md hover:bg-[#2C2A27] transition-colors shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download
                  </a>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border border-[#E5E3DE] bg-white p-6">
            <h2 className="font-display text-base font-semibold text-[#141413] mb-4">
              Print, Pricing &amp; Payment Breakdown
            </h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <div>
                <dt className="text-xs text-[#6B6760]">Printing Type</dt>
                <dd className="font-medium text-[#141413] mt-0.5">
                  {order.printing.printType === 'bw'
                    ? 'Black & White'
                    : order.printing.printType === 'color'
                      ? 'Colour'
                      : `Mixed (${order.printing.bwPages} B&W / ${order.printing.colorPages} Colour)`}{' '}
                  · {order.printing.sides === 'double' ? 'Double-sided' : 'Single-sided'} ·{' '}
                  {order.printing.paperSize}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#6B6760]">Copies &amp; Finishing</dt>
                <dd className="font-mono font-semibold text-[#141413] tabular-nums mt-0.5">
                  {order.printing.copies} {order.printing.copies === 1 ? 'copy' : 'copies'} ·{' '}
                  <span className="font-sans font-medium">{finishingLabel}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#6B6760]">Printing Cost</dt>
                <dd className="font-mono text-[#141413] tabular-nums mt-0.5">
                  {order.pricing.currency}{' '}
                  {(order.pricing.printingCost ?? (order.pricing.bwCost + order.pricing.colorCost)).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#6B6760]">Packaging &amp; Delivery</dt>
                <dd className="font-mono text-[#141413] tabular-nums mt-0.5">
                  {order.pricing.currency}{' '}
                  {((order.pricing.packagingCost ?? order.pricing.envelopeCost) + (order.pricing.deliveryFee ?? 0)).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#6B6760]">Total Amount</dt>
                <dd className="font-mono text-base font-bold text-[#141413] tabular-nums mt-0.5">
                  {order.pricing.currency} {order.pricing.total.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#6B6760]">Payment Method &amp; Status</dt>
                <dd className="font-medium text-[#141413] mt-0.5">
                  {paymentLabel} · <span className="font-mono text-xs">{order.payment.status}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#6B6760]">Delivery / Pickup</dt>
                <dd className="text-[#141413] mt-0.5">
                  {order.delivery.method === 'campus_delivery'
                    ? order.delivery.location
                    : 'Print Shop Pickup'}{' '}
                  · {order.delivery.timeWindow}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#6B6760]">Student Contact</dt>
                <dd className="font-mono text-[#141413] tabular-nums mt-0.5">
                  {order.customer.whatsappPhone}
                  {order.customer.altPhone ? ` / ${order.customer.altPhone}` : ''}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <aside className="lg:col-span-5 space-y-4">
          <div className="no-print">
            <h2 className="font-display text-lg font-semibold text-[#141413]">
              Brown Envelope Label
            </h2>
            <p className="text-sm text-[#57544E] mt-1">
              Connected directly from student order details.
            </p>
          </div>
          <EnvelopePreview
            customer={order.customer}
            envelopeQuantity={order.printing.envelopeQuantity}
            copies={order.printing.copies}
            finishingLabel={finishingLabel}
            envelopeNote={order.envelopeLabel.note}
            orderId={order.orderId}
          />
        </aside>
      </div>
    </main>
  );
};
