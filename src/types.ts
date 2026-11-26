export type PrintType = 'bw' | 'color' | 'mixed';
export type PrintSides = 'single' | 'double';
export type PaperSize = 'A4';

export type FinishingType =
  | 'none'
  | 'stapling'
  | 'spiral_binding'
  | 'thermal_binding';

export type DeliveryMethod = 'campus_delivery' | 'shop_pickup';
export type PaymentMethod = 'orange_money' | 'afri_money' | 'payment_on_delivery';
export type PaymentStatus = 'PENDING' | 'CONFIRMED' | 'FAILED';

export type OrderStatus =
  | 'ORDER RECEIVED'
  | 'AWAITING PAYMENT'
  | 'PAYMENT CONFIRMED'
  | 'PRINTING IN PROGRESS'
  | 'READY FOR COLLECTION'
  | 'OUT FOR DELIVERY'
  | 'SUCCESSFULLY DELIVERED'
  | 'CANCELLED';

export type LegacyOrderStatus = 'PRINTING' | 'COMPLETED' | 'DELIVERED';

export interface TrackingStageMeta {
  status: Exclude<OrderStatus, 'CANCELLED'>;
  label: string;
  description: string;
}

export const ORDER_TRACKING_STAGES: TrackingStageMeta[] = [
  {
    status: 'ORDER RECEIVED',
    label: 'Order received',
    description: 'Your documents and order reference are registered in our system.',
  },
  {
    status: 'AWAITING PAYMENT',
    label: 'Awaiting payment',
    description: 'Quotation sent. Complete payment or confirm cash on delivery.',
  },
  {
    status: 'PAYMENT CONFIRMED',
    label: 'Payment confirmed',
    description: 'Payment verified and cleared for studio production.',
  },
  {
    status: 'PRINTING IN PROGRESS',
    label: 'Printing in progress',
    description: 'Your pages are being printed, finished, and labeled.',
  },
  {
    status: 'READY FOR COLLECTION',
    label: 'Ready for collection',
    description: 'Packaged cleanly in your brown envelope and ready at the desk.',
  },
  {
    status: 'OUT FOR DELIVERY',
    label: 'Out for delivery',
    description: 'Dispatched with our campus courier to your selected drop-off point.',
  },
  {
    status: 'SUCCESSFULLY DELIVERED',
    label: 'Successfully delivered',
    description: 'Assignment handed over and order completed.',
  },
];

export function normalizeOrderStatus(raw: string | undefined | null): OrderStatus {
  switch (raw) {
    case 'PRINTING':
      return 'PRINTING IN PROGRESS';
    case 'COMPLETED':
      return 'READY FOR COLLECTION';
    case 'DELIVERED':
      return 'SUCCESSFULLY DELIVERED';
    case 'ORDER RECEIVED':
    case 'AWAITING PAYMENT':
    case 'PAYMENT CONFIRMED':
    case 'PRINTING IN PROGRESS':
    case 'READY FOR COLLECTION':
    case 'OUT FOR DELIVERY':
    case 'SUCCESSFULLY DELIVERED':
    case 'CANCELLED':
      return raw;
    default:
      return 'ORDER RECEIVED';
  }
}

export type DispatchNotifyStatus = 'SENT' | 'FAILED' | 'PENDING';
export type WhatsAppNotifyStatus = DispatchNotifyStatus;

export const DEFAULT_CURRENCY = 'SLE';
export const RATE_BW_SHEET = 2;
export const RATE_COLOR_SHEET = 5;
export const RATE_BROWN_ENVELOPE = 5;

export interface PricingConfig {
  currency: string;
  bwPagePrice: number;
  colorPagePrice: number;
  singleSidedPrice: number;
  doubleSidedPrice: number;
  brownEnvelopePrice: number;
  bindingPrice: number;
  deliveryFee: number;
  additionalServiceCharge: number;
  updatedAt?: string;
}

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  currency: DEFAULT_CURRENCY,
  bwPagePrice: RATE_BW_SHEET,
  colorPagePrice: RATE_COLOR_SHEET,
  singleSidedPrice: 0,
  doubleSidedPrice: 0,
  brownEnvelopePrice: RATE_BROWN_ENVELOPE,
  bindingPrice: 0,
  deliveryFee: 0,
  additionalServiceCharge: 0,
};

export interface PrintingServiceItem {
  id: string;
  name: string;
  category: 'printing' | 'finishing' | 'document' | 'delivery';
  description: string;
  price: number;
  unitLabel: string;
  enabled: boolean;
}

export const DEFAULT_PRINTING_SERVICES: PrintingServiceItem[] = [
  {
    id: 'bw_printing',
    name: 'Black-and-white printing',
    category: 'printing',
    description: 'Crisp monochrome A4 laser printing for coursework, notes, and drafts.',
    price: 0,
    unitLabel: 'uses B&W page rate',
    enabled: true,
  },
  {
    id: 'color_printing',
    name: 'Colour printing',
    category: 'printing',
    description: 'Full-colour A4 printing for design portfolios, charts, and diagrams.',
    price: 0,
    unitLabel: 'uses colour page rate',
    enabled: true,
  },
  {
    id: 'single_sided',
    name: 'Single-sided printing',
    category: 'printing',
    description: 'One document page printed per physical A4 sheet.',
    price: 0,
    unitLabel: 'per sheet modifier',
    enabled: true,
  },
  {
    id: 'double_sided',
    name: 'Double-sided printing',
    category: 'printing',
    description: 'Duplex printing with two document pages per physical A4 sheet.',
    price: 0,
    unitLabel: 'per sheet modifier',
    enabled: true,
  },
  {
    id: 'assignment_printing',
    name: 'Assignment printing',
    category: 'document',
    description: 'Standard academic assignment formatting check & print preparation.',
    price: 0,
    unitLabel: 'per order',
    enabled: true,
  },
  {
    id: 'project_printing',
    name: 'Project printing',
    category: 'document',
    description: 'Final-year dissertation, thesis, and capstone project preparation.',
    price: 0,
    unitLabel: 'per order',
    enabled: true,
  },
  {
    id: 'exam_materials',
    name: 'Examination materials printing',
    category: 'document',
    description: 'Past papers, study handouts, and exam revision material sets.',
    price: 0,
    unitLabel: 'per order',
    enabled: true,
  },
  {
    id: 'photocopying',
    name: 'Photocopying',
    category: 'document',
    description: 'High-speed A4 duplication from physical originals or handouts.',
    price: 0,
    unitLabel: 'per order',
    enabled: true,
  },
  {
    id: 'scanning',
    name: 'Scanning',
    category: 'document',
    description: 'High-resolution PDF scanning of signed forms and printed documents.',
    price: 0,
    unitLabel: 'per order',
    enabled: true,
  },
  {
    id: 'brown_envelope',
    name: 'Brown envelope packaging',
    category: 'finishing',
    description: 'Personalized A4 kraft brown envelope with printed student label.',
    price: 0,
    unitLabel: 'uses envelope rate',
    enabled: true,
  },
  {
    id: 'document_delivery',
    name: 'Document delivery',
    category: 'delivery',
    description: 'Hand-delivery to campus gate, faculty wing, or hostel address.',
    price: 0,
    unitLabel: 'uses delivery fee',
    enabled: true,
  },
];

export interface FinishingOptionMeta {
  id: FinishingType;
  label: string;
  shortDesc: string;
  availabilityNote: string;
}

export const FINISHING_OPTIONS: FinishingOptionMeta[] = [
  {
    id: 'none',
    label: 'Unbound / Loose Sheets',
    shortDesc: 'Crisp stacked A4 pages placed cleanly inside your brown envelope.',
    availabilityNote: 'Always available',
  },
  {
    id: 'stapling',
    label: 'Stapling',
    shortDesc: 'Heavy-duty corner or side staple finishing.',
    availabilityNote: 'Subject to availability',
  },
  {
    id: 'spiral_binding',
    label: 'Spiral Binding',
    shortDesc: 'Comb or spiral binding with clear front cover.',
    availabilityNote: 'Subject to availability',
  },
  {
    id: 'thermal_binding',
    label: 'Thermal Binding',
    shortDesc: 'Flush adhesive spine binding for reports and theses.',
    availabilityNote: 'Subject to availability',
  },
];

export const DEFAULT_INSTITUTIONS = [
  'Limkokwing University of Creative Technology',
  'Fourah Bay College (USL)',
  'Institute of Public Administration & Management (IPAM)',
  'College of Medicine & Allied Health Sciences (COMAHS)',
  'Njala University',
  'Other College / University',
] as const;

export const LIMKOKWING_DEPARTMENTS = [
  'Faculty of Architecture & Built Environment',
  'Faculty of Design Innovation',
  'Faculty of Creative Multimedia',
  'Faculty of Communication, Media & Broadcasting',
  'Faculty of Information & Communication Technology',
  'Faculty of Business & Globalization',
  'Faculty of Sound & Music Design',
] as const;

export const CAMPUS_DROP_ZONES = [
  'Main Campus Gate',
  'Architecture & Design Block',
  'Library Courtyard',
  'ICT & Multimedia Wing',
  'Student Common / Cafeteria',
  'Hostel / Off-Campus Address',
] as const;

export const DELIVERY_TIME_WINDOWS = [
  'Next Available (Urgent / Class Today)',
  'Morning (08:00 – 11:00)',
  'Midday (11:00 – 14:00)',
  'Afternoon (14:00 – 17:00)',
] as const;

export interface PaymentOptionMeta {
  id: PaymentMethod;
  label: string;
  description: string;
  requiresReferenceHint: boolean;
}

export const PAYMENT_OPTIONS: PaymentOptionMeta[] = [
  {
    id: 'orange_money',
    label: 'Orange Money',
    description: 'Pay via Orange Money. Payment remains Pending until verified by an administrator.',
    requiresReferenceHint: true,
  },
  {
    id: 'afri_money',
    label: 'Africell Money (Afrimoney)',
    description: 'Pay via Africell Money (Afrimoney). Payment remains Pending until verified by an administrator.',
    requiresReferenceHint: true,
  },
  {
    id: 'payment_on_delivery',
    label: 'Payment on Delivery',
    description: 'Pay when collecting or receiving your printed assignment.',
    requiresReferenceHint: false,
  },
];

export interface CustomerDetails {
  fullName: string;
  studentId: string;
  institution: string;
  department: string;
  course: string;
  lecturerName: string;
  assignmentTitle: string;
  whatsappPhone: string;
  altPhone?: string;
}

export interface UploadedDocumentMeta {
  filename: string;
  pages: number;
  sizeBytes: number;
  storagePath: string;
  secureDownloadUrl: string;
}

export interface UploadedDocumentItem extends UploadedDocumentMeta {
  fileId: string;
  mimeType: string;
  extension: 'pdf' | 'doc' | 'docx';
}

export interface PrintingPreferences {
  printType: PrintType;
  bwPages: number;
  colorPages: number;
  sides: PrintSides;
  copies: number;
  paperSize: PaperSize;
  finishing: FinishingType;
  envelopeQuantity: number;
  notes: string;
}

export interface OrderPricing {
  currency: string;
  bwSheets: number;
  colorSheets: number;
  bwCost: number;
  colorCost: number;
  sidedCost?: number;
  printingCost?: number;
  envelopeCost: number;
  bindingCost?: number;
  packagingCost?: number;
  deliveryFee?: number;
  additionalServicesCost?: number;
  additionalCharges: number;
  total: number;
}

export function calculateDynamicOrderPrice(params: {
  pages: number;
  printType: PrintType;
  bwPages: number;
  colorPages: number;
  sides: PrintSides;
  copies: number;
  envelopeQuantity: number;
  finishing?: FinishingType;
  deliveryMethod?: DeliveryMethod;
  selectedServiceIds?: string[];
  servicesCatalog?: PrintingServiceItem[];
  pricingConfig?: PricingConfig;
  additionalCharges?: number;
  currency?: string;
}): OrderPricing {
  const cfg = params.pricingConfig || DEFAULT_PRICING_CONFIG;
  const safePages = Math.min(2000, Math.max(1, Math.round(params.pages || 1)));
  const safeCopies = Math.min(200, Math.max(1, Math.round(params.copies || 1)));
  const safeEnvelopes = Math.min(200, Math.max(0, Math.round(params.envelopeQuantity || 0)));
  const safeApprovedExtra = Math.max(0, Number(params.additionalCharges || 0));
  const currency = (params.currency || cfg.currency || DEFAULT_CURRENCY).trim() || DEFAULT_CURRENCY;

  let effectiveBwPages = 0;
  let effectiveColorPages = 0;

  if (params.printType === 'bw') {
    effectiveBwPages = safePages;
    effectiveColorPages = 0;
  } else if (params.printType === 'color') {
    effectiveBwPages = 0;
    effectiveColorPages = safePages;
  } else {
    const clampedBw = Math.min(safePages, Math.max(0, Math.round(params.bwPages || 0)));
    effectiveBwPages = clampedBw;
    effectiveColorPages = Math.max(0, safePages - clampedBw);
  }

  const bwSheets =
    params.sides === 'double' ? Math.ceil(effectiveBwPages / 2) : effectiveBwPages;
  const colorSheets =
    params.sides === 'double' ? Math.ceil(effectiveColorPages / 2) : effectiveColorPages;

  const bwCost = Number((bwSheets * safeCopies * Math.max(0, cfg.bwPagePrice)).toFixed(2));
  const colorCost = Number((colorSheets * safeCopies * Math.max(0, cfg.colorPagePrice)).toFixed(2));
  const sidedRate =
    params.sides === 'double'
      ? Math.max(0, cfg.doubleSidedPrice)
      : Math.max(0, cfg.singleSidedPrice);
  const sidedCost = Number(((bwSheets + colorSheets) * safeCopies * sidedRate).toFixed(2));
  const printingCost = Number((bwCost + colorCost + sidedCost).toFixed(2));

  const envelopeCost = Number((safeEnvelopes * Math.max(0, cfg.brownEnvelopePrice)).toFixed(2));
  const bindingCost =
    params.finishing && params.finishing !== 'none'
      ? Number((safeCopies * Math.max(0, cfg.bindingPrice)).toFixed(2))
      : 0;
  const packagingCost = Number((envelopeCost + bindingCost).toFixed(2));

  const selectedIds = Array.isArray(params.selectedServiceIds) ? params.selectedServiceIds : [];
  const catalog = Array.isArray(params.servicesCatalog) ? params.servicesCatalog : [];
  const selectedServiceFees = selectedIds.reduce((sum, id) => {
    const svc = catalog.find((s) => s.id === id && s.enabled);
    return sum + (svc ? Math.max(0, Number(svc.price) || 0) : 0);
  }, 0);

  const hasExtraServicesSelected = selectedIds.some(
    (id) => !['bw_printing', 'color_printing', 'single_sided', 'double_sided', 'brown_envelope', 'document_delivery'].includes(id),
  );
  const baseAdditionalCharge = hasExtraServicesSelected
    ? Math.max(0, Number(cfg.additionalServiceCharge) || 0)
    : 0;
  const additionalServicesCost = Number(
    (selectedServiceFees + baseAdditionalCharge).toFixed(2),
  );

  const deliveryFee =
    params.deliveryMethod === 'campus_delivery'
      ? Number(Math.max(0, cfg.deliveryFee).toFixed(2))
      : 0;

  const total = Number(
    (printingCost + packagingCost + additionalServicesCost + deliveryFee + safeApprovedExtra).toFixed(2),
  );

  return {
    currency,
    bwSheets,
    colorSheets,
    bwCost,
    colorCost,
    sidedCost,
    printingCost,
    envelopeCost,
    bindingCost,
    packagingCost,
    deliveryFee,
    additionalServicesCost,
    additionalCharges: safeApprovedExtra,
    total,
  };
}

export function calculateOrderPrice(params: {
  pages: number;
  printType: PrintType;
  bwPages: number;
  colorPages: number;
  sides: PrintSides;
  copies: number;
  envelopeQuantity: number;
  additionalCharges?: number;
  currency?: string;
}): OrderPricing {
  return calculateDynamicOrderPrice({
    ...params,
    pricingConfig: DEFAULT_PRICING_CONFIG,
  });
}

export interface PaymentDetails {
  method: PaymentMethod;
  status: PaymentStatus;
  reference: string;
}

export interface DeliveryDetails {
  method: DeliveryMethod;
  location: string;
  timeWindow: string;
  instructions: string;
}

export interface EnvelopeLabelMeta {
  storagePath: string;
  secureLabelUrl: string;
  note: string;
}

export interface NotificationMeta {
  status: DispatchNotifyStatus;
  lastError: string;
  attempts: number;
}

export type WhatsAppNotificationMeta = NotificationMeta;
export type EmailNotificationMeta = NotificationMeta;

export interface WhatsAppSessionRef {
  conversationRef: string;
  senderPhone: string;
  step: string;
  lastMessageAt: string;
}

export interface OrderQuotationMeta {
  summary: string;
  quotedBy: string;
  quotedAt: string;
  totalAmount: number;
  currency: string;
}

export interface PrintOrderRecord {
  orderId: string;
  clientRequestId: string;
  submissionMode?: 'whatsapp_session' | 'web_checkout';
  status: OrderStatus;
  customer: CustomerDetails;
  document: UploadedDocumentMeta;
  documents?: UploadedDocumentItem[];
  selectedServices?: string[];
  printing: PrintingPreferences;
  pricing: OrderPricing;
  payment: PaymentDetails;
  delivery: DeliveryDetails;
  envelopeLabel: EnvelopeLabelMeta;
  whatsappNotification: WhatsAppNotificationMeta;
  emailNotification?: EmailNotificationMeta;
  whatsappSession?: WhatsAppSessionRef;
  quotation?: OrderQuotationMeta;
  createdAt: string;
  updatedAt: string;
}

export interface OrderAuditEntry {
  id?: string;
  orderId: string;
  action: string;
  actorEmail: string;
  previousValue: string;
  newValue: string;
  note: string;
  createdAt: string;
}

export interface StudioSettings {
  currency: string;
  orangeMoneyDetails: string;
  afriMoneyDetails: string;
  updatedAt?: string;
}

export interface AdminPrivateSettings {
  adminWhatsappNumbers: string[];
  whatsappTemplateName: string;
  whatsappTemplateLanguage: string;
  adminNotificationEmail?: string;
  updatedAt?: string;
}

export interface UploadedFilePayload {
  fileBase64: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  pages?: number;
  storagePath?: string;
  firebaseDownloadUrl?: string;
}

export interface SubmitOrderPayload {
  clientRequestId: string;
  preferredOrderId?: string;
  pdfBase64?: string;
  pdfFilename?: string;
  pdfSizeBytes?: number;
  files?: UploadedFilePayload[];
  customer: CustomerDetails;
  printing: PrintingPreferences;
  selectedServices?: string[];
  payment: {
    method: PaymentMethod;
    reference: string;
  };
  delivery: DeliveryDetails;
  envelopeNote: string;
  currency?: string;
  storagePath?: string;
  labelStoragePath?: string;
  labelDownloadUrl?: string;
}

export interface UploadSessionPayload {
  clientRequestId: string;
  preferredOrderId?: string;
  files: UploadedFilePayload[];
  customer?: Partial<CustomerDetails>;
  printing?: Partial<PrintingPreferences>;
  selectedServices?: string[];
  delivery?: Partial<DeliveryDetails>;
  envelopeNote?: string;
  labelDownloadUrl?: string;
}
