import {
  CustomerDetails,
  DeliveryDetails,
  FINISHING_OPTIONS,
  OrderPricing,
  PAYMENT_OPTIONS,
  PaymentDetails,
  PrintingPreferences,
  UploadedDocumentItem,
  UploadedDocumentMeta,
} from './types';

export const BUSINESS_WHATSAPP_NUMBER = '23279576978';
export const WHATSAPP_BASE_URL = `https://wa.me/${BUSINESS_WHATSAPP_NUMBER}`;

export function generateOrderReference(): string {
  const bytes = new Uint8Array(3);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    bytes[0] = Math.floor(Math.random() * 256);
    bytes[1] = Math.floor(Math.random() * 256);
    bytes[2] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return `DEE-${hex}`;
}

function hasRealValue(val: string | undefined | null): val is string {
  if (!val) return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  return !['Pending', 'Pending via WhatsApp', 'WhatsApp'].includes(trimmed);
}

export interface BuildWhatsappOrderUrlInput {
  orderId: string;
  documents?: UploadedDocumentItem[];
  document?: UploadedDocumentMeta;
  customer?: Partial<CustomerDetails>;
  printing?: Partial<PrintingPreferences>;
  pricing?: Partial<OrderPricing>;
  delivery?: Partial<DeliveryDetails>;
  payment?: Partial<PaymentDetails>;
  selectedServiceNames?: string[];
  envelopeNote?: string;
}

export function buildWhatsappOrderUrl(input: BuildWhatsappOrderUrlInput): string {
  const {
    orderId,
    documents,
    document,
    customer,
    printing,
    pricing,
    delivery,
    payment,
    selectedServiceNames,
    envelopeNote,
  } = input;

  const lines: string[] = [
    'Hello Dee Prints. I want to place a printing order.',
    '',
    `Order Reference: ${orderId}`,
  ];

  const docItems: Array<{ filename: string; pages: number; url: string }> =
    documents && documents.length > 0
      ? documents.map((d) => ({
          filename: d.filename,
          pages: d.pages,
          url: d.secureDownloadUrl,
        }))
      : document
        ? [
            {
              filename: document.filename,
              pages: document.pages,
              url: document.secureDownloadUrl,
            },
          ]
        : [];

  if (docItems.length > 0) {
    const totalPages = docItems.reduce((sum, d) => sum + Math.max(1, d.pages || 1), 0);
    lines.push('');
    lines.push(
      `Uploaded Document${docItems.length > 1 ? 's' : ''} (${docItems.length} file${docItems.length === 1 ? '' : 's'}, ${totalPages} page${totalPages === 1 ? '' : 's'}):`,
    );
    docItems.forEach((item, idx) => {
      lines.push(`${idx + 1}. ${item.filename} (${item.pages}p)`);
      if (item.url && /^https?:\/\//i.test(item.url)) {
        lines.push(`Document URL: ${item.url}`);
      }
    });
  }

  if (printing) {
    const finishingLabel =
      FINISHING_OPTIONS.find((f) => f.id === printing.finishing)?.label ||
      printing.finishing ||
      'Unbound';
    const printTypeLabel =
      printing.printType === 'color'
        ? 'Colour'
        : printing.printType === 'mixed'
          ? `Mixed (${printing.bwPages ?? 0} B&W / ${printing.colorPages ?? 0} Colour)`
          : 'Black & White';

    lines.push('');
    lines.push(
      `Print Spec: ${printing.copies || 1}x copy/copies | ${printTypeLabel} | ${printing.sides === 'double' ? 'Double-sided' : 'Single-sided'} | ${finishingLabel} | Brown Envelopes: ${printing.envelopeQuantity ?? 0}`,
    );
    if (selectedServiceNames && selectedServiceNames.length > 0) {
      lines.push(`Services: ${selectedServiceNames.join(', ')}`);
    }
    if (printing.notes?.trim()) {
      lines.push(`Print Notes: ${printing.notes.trim()}`);
    }
  }

  if (pricing && typeof pricing.total === 'number') {
    const cur = pricing.currency || 'SLE';
    lines.push(`Estimated Total: ${cur} ${pricing.total.toLocaleString()}`);
  }

  const studentLines: string[] = [];
  if (customer) {
    if (hasRealValue(customer.fullName)) studentLines.push(`Name: ${customer.fullName.trim()}`);
    if (hasRealValue(customer.studentId)) studentLines.push(`Student ID: ${customer.studentId.trim()}`);
    if (hasRealValue(customer.institution)) studentLines.push(`School/University: ${customer.institution.trim()}`);
    if (hasRealValue(customer.department)) studentLines.push(`Department: ${customer.department.trim()}`);
    if (hasRealValue(customer.course)) studentLines.push(`Course: ${customer.course.trim()}`);
    if (hasRealValue(customer.lecturerName)) studentLines.push(`Lecturer: ${customer.lecturerName.trim()}`);
    if (hasRealValue(customer.assignmentTitle)) studentLines.push(`Assignment: ${customer.assignmentTitle.trim()}`);
    if (hasRealValue(customer.whatsappPhone)) studentLines.push(`Phone: ${customer.whatsappPhone.trim()}`);
    if (hasRealValue(customer.altPhone)) studentLines.push(`Alt Phone: ${customer.altPhone.trim()}`);
  }

  if (studentLines.length > 0) {
    lines.push('');
    lines.push('Student Details:');
    lines.push(...studentLines);
  }

  if (delivery?.method) {
    const deliveryText =
      delivery.method === 'shop_pickup'
        ? 'Print Shop Collection'
        : `Campus Delivery${hasRealValue(delivery.location) ? ` - ${delivery.location.trim()}` : ''}`;
    lines.push(`Delivery: ${deliveryText}${delivery.timeWindow ? ` (${delivery.timeWindow})` : ''}`);
    if (delivery.instructions?.trim()) {
      lines.push(`Delivery Instructions: ${delivery.instructions.trim()}`);
    }
  }

  if (envelopeNote?.trim()) {
    lines.push(`Envelope Note: ${envelopeNote.trim()}`);
  }

  if (payment?.method) {
    const paymentLabel =
      PAYMENT_OPTIONS.find((p) => p.id === payment.method)?.label || payment.method;
    lines.push(
      `Payment Method: ${paymentLabel}${payment.reference?.trim() ? ` (Ref: ${payment.reference.trim()})` : ''}`,
    );
  }

  lines.push('');
  lines.push(
    'I have uploaded my document through your website. Please help me complete my order.',
  );

  return `${WHATSAPP_BASE_URL}?text=${encodeURIComponent(lines.join('\n'))}`;
}
