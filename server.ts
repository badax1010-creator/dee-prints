import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import nodemailer from 'nodemailer';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { buildEnvelopeLabelHtml } from './src/envelopeHtml.ts';
import {
  AdminPrivateSettings,
  calculateDynamicOrderPrice,
  DEFAULT_CURRENCY,
  DEFAULT_PRICING_CONFIG,
  DEFAULT_PRINTING_SERVICES,
  EmailNotificationMeta,
  FINISHING_OPTIONS,
  normalizeOrderStatus,
  OrderStatus,
  PAYMENT_OPTIONS,
  PaymentMethod,
  PaymentStatus,
  PricingConfig,
  PrintingServiceItem,
  PrintOrderRecord,
  SubmitOrderPayload,
  UploadedDocumentItem,
  UploadedFilePayload,
  UploadSessionPayload,
  WhatsAppNotificationMeta,
} from './src/types.ts';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads');
const ORDERS_DB_PATH = path.join(UPLOADS_ROOT, 'orders.json');
const ADMIN_SETTINGS_PATH = path.join(UPLOADS_ROOT, 'admin_settings.json');
const PRICING_CONFIG_PATH = path.join(UPLOADS_ROOT, 'pricing_config.json');
const SERVICES_CATALOG_PATH = path.join(UPLOADS_ROOT, 'services_catalog.json');
const WHATSAPP_SESSIONS_PATH = path.join(UPLOADS_ROOT, 'whatsapp_sessions.json');
const ADMIN_EMAIL = 'badax1010@gmail.com';
const DEFAULT_BUSINESS_WA = '23279576978';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES_PER_ORDER = 10;
const SIGNED_LINK_TTL_MS = 48 * 60 * 60 * 1000;

const inFlightRequestIds = new Set<string>();

interface WhatsappConversationState {
  senderPhone: string;
  orderId: string;
  step:
    | 'awaiting_order_ref'
    | 'awaiting_full_name'
    | 'awaiting_student_id'
    | 'awaiting_institution'
    | 'awaiting_department'
    | 'awaiting_delivery_method'
    | 'awaiting_delivery_location'
    | 'awaiting_copies'
    | 'quoted';
  lastMessageAt: string;
}

function loadFirebaseWebApiKey(): string {
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { apiKey?: string };
      return String(cfg.apiKey || '').trim();
    }
  } catch {
    // Ignore parse failures
  }
  return '';
}

const FIREBASE_WEB_API_KEY = loadFirebaseWebApiKey();

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_ROOT)) {
    fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
  }
  if (!fs.existsSync(ORDERS_DB_PATH)) {
    fs.writeFileSync(ORDERS_DB_PATH, JSON.stringify({}, null, 2), 'utf8');
  }
}

function getSigningSecret(): string {
  const fromEnv = process.env.DOWNLOAD_SIGNING_SECRET?.trim();
  if (fromEnv && fromEnv.length >= 16) {
    return fromEnv;
  }
  return crypto.randomBytes(32).toString('hex');
}

const SIGNING_SECRET = getSigningSecret();

function signToken(resource: string, orderId: string, expMs: number, fileId = ''): string {
  return crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(`${resource}:${orderId}:${fileId}:${expMs}`)
    .digest('hex');
}

function verifyToken(
  resource: string,
  orderId: string,
  expRaw: unknown,
  sigRaw: unknown,
  fileId = '',
): boolean {
  if (typeof expRaw !== 'string' || typeof sigRaw !== 'string') return false;
  const expMs = Number(expRaw);
  if (!Number.isFinite(expMs) || Date.now() > expMs) return false;
  const expected = signToken(resource, orderId, expMs, fileId);
  const sigBuf = Buffer.from(sigRaw, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

function createSignedUrl(
  baseUrl: string,
  resource: 'document' | 'label' | 'order',
  orderId: string,
  fileId = '',
): string {
  const exp = Date.now() + SIGNED_LINK_TTL_MS;
  const sig = signToken(resource, orderId, exp, fileId);
  const pathPrefix =
    resource === 'document'
      ? `/api/secure/document/${encodeURIComponent(orderId)}`
      : resource === 'label'
        ? `/api/secure/label/${encodeURIComponent(orderId)}`
        : `/api/orders/${encodeURIComponent(orderId)}`;
  const fileParam = fileId ? `&fileId=${encodeURIComponent(fileId)}` : '';
  return `${baseUrl}${pathPrefix}?exp=${exp}&sig=${sig}${fileParam}`;
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  ensureUploadsDir();
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    }
  } catch {
    // fallback
  }
  return fallback;
}

function writeJsonFile(filePath: string, value: unknown) {
  ensureUploadsDir();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function readOrdersDb(): Record<string, PrintOrderRecord> {
  return readJsonFile<Record<string, PrintOrderRecord>>(ORDERS_DB_PATH, {});
}

function writeOrdersDb(db: Record<string, PrintOrderRecord>) {
  writeJsonFile(ORDERS_DB_PATH, db);
}

function readPricingConfig(): PricingConfig {
  const saved = readJsonFile<Partial<PricingConfig>>(PRICING_CONFIG_PATH, {});
  return {
    ...DEFAULT_PRICING_CONFIG,
    ...saved,
    currency: String(saved.currency || DEFAULT_PRICING_CONFIG.currency).trim() || DEFAULT_CURRENCY,
  };
}

function writePricingConfig(cfg: PricingConfig) {
  writeJsonFile(PRICING_CONFIG_PATH, cfg);
}

function readServicesCatalog(): PrintingServiceItem[] {
  const saved = readJsonFile<PrintingServiceItem[]>(SERVICES_CATALOG_PATH, []);
  if (Array.isArray(saved) && saved.length > 0) {
    return saved;
  }
  return DEFAULT_PRINTING_SERVICES;
}

function writeServicesCatalog(services: PrintingServiceItem[]) {
  writeJsonFile(SERVICES_CATALOG_PATH, services);
}

function readWhatsappSessions(): Record<string, WhatsappConversationState> {
  return readJsonFile<Record<string, WhatsappConversationState>>(WHATSAPP_SESSIONS_PATH, {});
}

function writeWhatsappSessions(sessions: Record<string, WhatsappConversationState>) {
  writeJsonFile(WHATSAPP_SESSIONS_PATH, sessions);
}

function readAdminSettings(): AdminPrivateSettings {
  ensureUploadsDir();
  const rawEnvNum = (process.env.WHATSAPP_RECIPIENT_NUMBER?.trim() || DEFAULT_BUSINESS_WA).replace(/\D/g, '');
  const envDefaultNumber = rawEnvNum.startsWith('0') ? `232${rawEnvNum.slice(1)}` : rawEnvNum;
  const envTemplateName = process.env.WHATSAPP_TEMPLATE_NAME?.trim() || '';
  const envTemplateLanguage = process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || 'en_US';
  const envAdminEmail = process.env.ADMIN_NOTIFICATION_EMAIL?.trim() || ADMIN_EMAIL;

  try {
    if (fs.existsSync(ADMIN_SETTINGS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(ADMIN_SETTINGS_PATH, 'utf8')) as Partial<AdminPrivateSettings>;
      const numbers = Array.isArray(parsed.adminWhatsappNumbers)
        ? parsed.adminWhatsappNumbers.map((n) => String(n).replace(/\D/g, '')).filter((n) => n.length >= 7)
        : [];
      return {
        adminWhatsappNumbers: numbers.length > 0 ? numbers : [envDefaultNumber || DEFAULT_BUSINESS_WA],
        whatsappTemplateName: parsed.whatsappTemplateName?.trim() || envTemplateName,
        whatsappTemplateLanguage: parsed.whatsappTemplateLanguage?.trim() || envTemplateLanguage,
        adminNotificationEmail: parsed.adminNotificationEmail?.trim() || envAdminEmail,
        updatedAt: parsed.updatedAt,
      };
    }
  } catch {
    // Fallback
  }

  return {
    adminWhatsappNumbers: [envDefaultNumber || DEFAULT_BUSINESS_WA],
    whatsappTemplateName: envTemplateName,
    whatsappTemplateLanguage: envTemplateLanguage,
    adminNotificationEmail: envAdminEmail,
  };
}

function writeAdminSettings(settings: AdminPrivateSettings) {
  writeJsonFile(ADMIN_SETTINGS_PATH, settings);
}

function sanitizeGenericFilename(name: string, ext: 'pdf' | 'doc' | 'docx'): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
  const lower = base.toLowerCase();
  if (lower.endsWith(`.${ext}`)) {
    return base.slice(0, 140);
  }
  return `${(base || 'document').replace(/\.+$/, '')}.${ext}`.slice(0, 140);
}

function detectAndValidateDocument(
  file: UploadedFilePayload,
): { ok: true; extension: 'pdf' | 'doc' | 'docx'; mimeType: string; buffer: Buffer; filename: string } | { ok: false; error: string } {
  const rawName = String(file.filename || '').trim();
  const extMatch = rawName.toLowerCase().match(/\.(pdf|docx|doc)$/);
  const extFromMime =
    file.mimeType === 'application/pdf'
      ? 'pdf'
      : file.mimeType === 'application/msword'
        ? 'doc'
        : file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          ? 'docx'
          : null;
  const extension = (extMatch?.[1] as 'pdf' | 'doc' | 'docx' | undefined) || extFromMime;

  if (!extension) {
    return {
      ok: false,
      error: `Unsupported file "${rawName}". Only PDF, DOC, and DOCX files are allowed.`,
    };
  }

  const rawBase64 = typeof file?.fileBase64 === 'string' ? file.fileBase64 : '';
  if (!rawBase64) {
    return {
      ok: false,
      error: `Missing file data for "${rawName || 'document'}".`,
    };
  }
  const base64Clean = rawBase64.includes(',')
    ? rawBase64.split(',')[1]
    : rawBase64;
  const buffer = Buffer.from(base64Clean, 'base64');

  if (buffer.byteLength === 0 || buffer.byteLength > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `File "${rawName}" is empty or exceeds the 20 MB maximum file size.`,
    };
  }

  if (extension === 'pdf') {
    if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      return { ok: false, error: `File "${rawName}" is not a valid PDF document.` };
    }
    return {
      ok: true,
      extension: 'pdf',
      mimeType: 'application/pdf',
      buffer,
      filename: sanitizeGenericFilename(rawName, 'pdf'),
    };
  }

  if (extension === 'doc') {
    const isOle =
      buffer.byteLength >= 8 &&
      buffer[0] === 0xd0 &&
      buffer[1] === 0xcf &&
      buffer[2] === 0x11 &&
      buffer[3] === 0xe0;
    const isRtfOrXml = buffer.subarray(0, 5).toString('ascii') === '{\\rtf' || buffer.subarray(0, 5).toString('ascii') === '<?xml';
    if (!isOle && !isRtfOrXml) {
      return { ok: false, error: `File "${rawName}" does not appear to be a valid .doc document.` };
    }
    return {
      ok: true,
      extension: 'doc',
      mimeType: 'application/msword',
      buffer,
      filename: sanitizeGenericFilename(rawName, 'doc'),
    };
  }

  // docx (ZIP container starting with PK\x03\x04)
  const isZip =
    buffer.byteLength >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04;
  if (!isZip) {
    return { ok: false, error: `File "${rawName}" is not a valid .docx archive.` };
  }
  return {
    ok: true,
    extension: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer,
    filename: sanitizeGenericFilename(rawName, 'docx'),
  };
}

function getBaseUrl(req: express.Request): string {
  const forwardedProto = req.get('x-forwarded-proto');
  const proto = forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host');
  if (host) {
    return `${proto}://${host}`;
  }
  const configured = process.env.SHARED_APP_URL?.trim() || process.env.APP_URL?.trim();
  if (configured && configured !== 'MY_APP_URL' && /^https?:\/\//i.test(configured)) {
    return configured.replace(/\/+$/, '');
  }
  return `http://localhost:${PORT}`;
}

function formatPrintTypeLabel(order: PrintOrderRecord): string {
  if (order.printing.printType === 'bw') return 'Black and White';
  if (order.printing.printType === 'color') return 'Colour';
  return `Mixed (${order.printing.bwPages} B&W / ${order.printing.colorPages} Colour)`;
}

function buildWhatsAppAdminNotificationText(order: PrintOrderRecord): string {
  const { customer, document, documents, printing, pricing, payment, envelopeLabel } = order;
  const cur = pricing.currency;
  const finishingLabel =
    FINISHING_OPTIONS.find((f) => f.id === printing.finishing)?.label || printing.finishing;
  const paymentLabel =
    PAYMENT_OPTIONS.find((p) => p.id === payment.method)?.label || payment.method;
  const filesList = documents && documents.length > 0
    ? documents.map((d, i) => `${i + 1}. ${d.filename} (${d.pages}p)`).join('\n')
    : `${document.filename} (${document.pages}p)`;

  const lines = [
    'NEW DEE PRINTS ORDER',
    '',
    `Order ID: ${order.orderId}`,
    `Mode: ${order.submissionMode === 'whatsapp_session' ? 'Website Upload -> WhatsApp Bot' : 'Direct Web Order'}`,
    '',
    'STUDENT INFORMATION:',
    `Name: ${customer.fullName}`,
    `Student ID: ${customer.studentId}`,
    `Institution: ${customer.institution}`,
    `Department: ${customer.department}`,
    `Course: ${customer.course}`,
    `Lecturer: ${customer.lecturerName}`,
    `Assignment: ${customer.assignmentTitle}`,
    `Phone: ${customer.whatsappPhone}${customer.altPhone ? ` · Alt: ${customer.altPhone}` : ''}`,
    '',
    'DOCUMENTS:',
    filesList,
    `Total Pages: ${document.pages} · Copies: ${printing.copies}`,
    '',
    'PRINTING:',
    `Type: ${formatPrintTypeLabel(order)}`,
    `Sides: ${printing.sides === 'double' ? 'Double-sided' : 'Single-sided'}`,
    `Paper: ${printing.paperSize}`,
    `Finishing: ${finishingLabel}`,
    `Envelope: ${printing.envelopeQuantity}`,
    '',
    'PRICE:',
    `Printing: ${cur} ${(pricing.printingCost ?? (pricing.bwCost + pricing.colorCost)).toLocaleString()}`,
    `Packaging (Envelopes + Binding): ${cur} ${(pricing.packagingCost ?? pricing.envelopeCost).toLocaleString()}`,
    `Delivery Fee: ${cur} ${(pricing.deliveryFee ?? 0).toLocaleString()}`,
    `Additional Services: ${cur} ${(pricing.additionalServicesCost ?? 0).toLocaleString()}`,
    `Total: ${cur} ${pricing.total.toLocaleString()}`,
    '',
    'PAYMENT:',
    `Method: ${paymentLabel}`,
    `Status: ${payment.status}`,
  ];

  if (payment.reference.trim()) {
    lines.push(`Reference: ${payment.reference.trim()}`);
  }
  if (printing.notes.trim()) {
    lines.push(`Print Notes: ${printing.notes.trim()}`);
  }
  lines.push(
    `Delivery: ${order.delivery.method === 'campus_delivery' ? order.delivery.location : 'Print Shop Pickup'} (${order.delivery.timeWindow})`,
  );
  if (order.delivery.instructions.trim()) {
    lines.push(`Delivery Instructions: ${order.delivery.instructions.trim()}`);
  }
  if (envelopeLabel.note.trim()) {
    lines.push(`Envelope Note: ${envelopeLabel.note.trim()}`);
  }

  lines.push('');
  lines.push('LINKS:');
  if (documents && documents.length > 0) {
    documents.forEach((d) => lines.push(`${d.filename}: ${d.secureDownloadUrl}`));
  } else {
    lines.push(`Secure Document Download: ${document.secureDownloadUrl}`);
  }
  lines.push(`Envelope Label: ${envelopeLabel.secureLabelUrl}`);
  lines.push('');
  lines.push(`ORDER STATUS: ${order.status}.`);

  return lines.join('\n');
}

async function sendTextViaWhatsAppCloudApi(toPhone: string, bodyText: string): Promise<boolean> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!accessToken || !phoneNumberId) return false;

  const graphBase = `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}`;
  try {
    const res = await fetch(`${graphBase}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toPhone.replace(/\D/g, ''),
        type: 'text',
        text: { preview_url: true, body: bodyText },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function sendOrderViaWhatsAppCloudApi(
  order: PrintOrderRecord,
  primaryFilePath: string,
  prevAttempts = 0,
): Promise<WhatsAppNotificationMeta> {
  const attempts = prevAttempts + 1;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();

  if (!accessToken || !phoneNumberId) {
    return {
      status: 'FAILED',
      lastError:
        'WhatsApp Cloud API credentials (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID) are not configured on the server.',
      attempts,
    };
  }

  const settings = readAdminSettings();
  const recipients = settings.adminWhatsappNumbers;
  if (recipients.length === 0) {
    return {
      status: 'FAILED',
      lastError: 'No administrator WhatsApp recipient number is configured.',
      attempts,
    };
  }

  const graphBase = `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}`;
  const bodyText = buildWhatsAppAdminNotificationText(order);

  try {
    let mediaId = '';
    const primaryDoc = order.documents?.[0];
    const primaryMime = primaryDoc?.mimeType || 'application/pdf';
    const primaryFilename = primaryDoc?.filename || order.document.filename;

    if (fs.existsSync(primaryFilePath)) {
      const fileBytes = fs.readFileSync(primaryFilePath);
      const formData = new FormData();
      formData.append('messaging_product', 'whatsapp');
      formData.append('type', primaryMime);
      formData.append(
        'file',
        new Blob([fileBytes], { type: primaryMime }),
        primaryFilename,
      );
      const mediaRes = await fetch(`${graphBase}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      });
      if (mediaRes.ok) {
        const mediaJson = (await mediaRes.json()) as { id?: string };
        mediaId = mediaJson.id || '';
      }
    }

    const errors: string[] = [];

    for (const recipient of recipients) {
      if (settings.whatsappTemplateName) {
        const templatePayload = {
          messaging_product: 'whatsapp',
          to: recipient,
          type: 'template',
          template: {
            name: settings.whatsappTemplateName,
            language: { code: settings.whatsappTemplateLanguage || 'en_US' },
            components: [
              ...(mediaId
                ? [
                    {
                      type: 'header',
                      parameters: [
                        {
                          type: 'document',
                          document: {
                            id: mediaId,
                            filename: primaryFilename,
                          },
                        },
                      ],
                    },
                  ]
                : []),
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: order.orderId },
                  { type: 'text', text: order.customer.fullName },
                  { type: 'text', text: order.customer.studentId },
                  { type: 'text', text: `${order.pricing.currency} ${order.pricing.total}` },
                ],
              },
            ],
          },
        };

        const tplRes = await fetch(`${graphBase}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(templatePayload),
        });

        if (!tplRes.ok) {
          const tplErr = await tplRes.text();
          errors.push(`Template (${recipient}): ${tplErr.slice(0, 180)}`);
        }
      }

      const textRes = await fetch(`${graphBase}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipient,
          type: 'text',
          text: {
            preview_url: true,
            body: bodyText,
          },
        }),
      });

      if (!textRes.ok) {
        const errText = await textRes.text();
        errors.push(`Text (${recipient}): ${errText.slice(0, 180)}`);
        continue;
      }

      if (mediaId && !settings.whatsappTemplateName) {
        const docRes = await fetch(`${graphBase}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: recipient,
            type: 'document',
            document: {
              id: mediaId,
              filename: primaryFilename,
              caption: `${order.orderId} · ${order.customer.fullName} (${order.document.pages} pages)`,
            },
          }),
        });
        if (!docRes.ok) {
          const docErr = await docRes.text();
          errors.push(`Document (${recipient}): ${docErr.slice(0, 180)}`);
        }
      }
    }

    if (errors.length > 0) {
      return {
        status: 'FAILED',
        lastError: errors.join(' | ').slice(0, 380),
        attempts,
      };
    }

    return {
      status: 'SENT',
      lastError: '',
      attempts,
    };
  } catch (err) {
    return {
      status: 'FAILED',
      lastError: err instanceof Error ? err.message.slice(0, 350) : 'WhatsApp Cloud API request failed.',
      attempts,
    };
  }
}

function escapeHtmlEmail(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isEmailConfigured(): boolean {
  const hasSmtp = Boolean(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
  const hasResend = Boolean(process.env.RESEND_API_KEY?.trim());
  return hasSmtp || hasResend;
}

function buildOrderEmailHtml(order: PrintOrderRecord): string {
  const { customer, document, documents, printing, pricing, payment, delivery, envelopeLabel } = order;
  const finishingLabel =
    FINISHING_OPTIONS.find((f) => f.id === printing.finishing)?.label || printing.finishing;
  const paymentLabel =
    PAYMENT_OPTIONS.find((p) => p.id === payment.method)?.label || payment.method;
  const cur = escapeHtmlEmail(pricing.currency);
  const filesHtml =
    documents && documents.length > 0
      ? documents.map((d) => `<li>${escapeHtmlEmail(d.filename)} (${d.pages} pages)</li>`).join('')
      : `<li>${escapeHtmlEmail(document.filename)} (${document.pages} pages)</li>`;

  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;color:#141413;background:#faf9f7;padding:24px;border:1px solid #e5e3de;border-radius:10px;">
    <h2 style="margin:0 0 6px;font-size:20px;">NEW DEE PRINTS ORDER — ${escapeHtmlEmail(order.orderId)}</h2>
    <p style="margin:0 0 18px;font-size:13px;color:#57544e;">Submitted ${escapeHtmlEmail(new Date(order.createdAt).toLocaleString())} · Status: <strong>${escapeHtmlEmail(order.status)}</strong></p>

    <div style="background:#ffffff;border:1px solid #e5e3de;border-radius:8px;padding:16px;margin-bottom:14px;">
      <h3 style="margin:0 0 10px;font-size:14px;text-transform:uppercase;color:#6b6760;">Student Information</h3>
      <p style="margin:4px 0;font-size:14px;"><strong>Name:</strong> ${escapeHtmlEmail(customer.fullName)}</p>
      <p style="margin:4px 0;font-size:14px;"><strong>Student ID:</strong> ${escapeHtmlEmail(customer.studentId)}</p>
      <p style="margin:4px 0;font-size:14px;"><strong>Institution:</strong> ${escapeHtmlEmail(customer.institution)}</p>
      <p style="margin:4px 0;font-size:14px;"><strong>Department:</strong> ${escapeHtmlEmail(customer.department)}</p>
      <p style="margin:4px 0;font-size:14px;"><strong>Course:</strong> ${escapeHtmlEmail(customer.course)}</p>
      <p style="margin:4px 0;font-size:14px;"><strong>Lecturer:</strong> ${escapeHtmlEmail(customer.lecturerName)}</p>
      <p style="margin:4px 0;font-size:14px;"><strong>Assignment:</strong> ${escapeHtmlEmail(customer.assignmentTitle)}</p>
      <p style="margin:4px 0;font-size:14px;"><strong>Phone:</strong> ${escapeHtmlEmail(customer.whatsappPhone)}${customer.altPhone ? ` · Alt: ${escapeHtmlEmail(customer.altPhone)}` : ''}</p>
    </div>

    <div style="background:#ffffff;border:1px solid #e5e3de;border-radius:8px;padding:16px;margin-bottom:14px;">
      <h3 style="margin:0 0 10px;font-size:14px;text-transform:uppercase;color:#6b6760;">Uploaded Documents &amp; Printing</h3>
      <ul style="margin:0 0 10px;padding-left:18px;font-size:14px;">${filesHtml}</ul>
      <p style="margin:4px 0;font-size:14px;"><strong>Copies:</strong> ${printing.copies}</p>
      <p style="margin:4px 0;font-size:14px;"><strong>Type:</strong> ${escapeHtmlEmail(formatPrintTypeLabel(order))} · ${escapeHtmlEmail(printing.sides === 'double' ? 'Double-sided' : 'Single-sided')} · ${escapeHtmlEmail(printing.paperSize)}</p>
      <p style="margin:4px 0;font-size:14px;"><strong>Finishing:</strong> ${escapeHtmlEmail(finishingLabel)}</p>
      <p style="margin:4px 0;font-size:14px;"><strong>Brown Envelopes:</strong> ${printing.envelopeQuantity}</p>
      ${printing.notes.trim() ? `<p style="margin:4px 0;font-size:14px;"><strong>Print Notes:</strong> ${escapeHtmlEmail(printing.notes.trim())}</p>` : ''}
      ${envelopeLabel.note.trim() ? `<p style="margin:4px 0;font-size:14px;"><strong>Envelope Note:</strong> ${escapeHtmlEmail(envelopeLabel.note.trim())}</p>` : ''}
    </div>

    <div style="background:#ffffff;border:1px solid #e5e3de;border-radius:8px;padding:16px;margin-bottom:14px;">
      <h3 style="margin:0 0 10px;font-size:14px;text-transform:uppercase;color:#6b6760;">Price, Payment &amp; Delivery</h3>
      <p style="margin:4px 0;font-size:14px;"><strong>Printing Cost:</strong> ${cur} ${(pricing.printingCost ?? (pricing.bwCost + pricing.colorCost)).toLocaleString()}</p>
      <p style="margin:4px 0;font-size:14px;"><strong>Packaging (Envelopes + Binding):</strong> ${cur} ${(pricing.packagingCost ?? pricing.envelopeCost).toLocaleString()}</p>
      <p style="margin:4px 0;font-size:14px;"><strong>Delivery Fee:</strong> ${cur} ${(pricing.deliveryFee ?? 0).toLocaleString()}</p>
      <p style="margin:4px 0;font-size:14px;"><strong>Additional Services:</strong> ${cur} ${(pricing.additionalServicesCost ?? 0).toLocaleString()}</p>
      <p style="margin:6px 0;font-size:16px;"><strong>Total: ${cur} ${pricing.total.toLocaleString()}</strong></p>
      <p style="margin:4px 0;font-size:14px;"><strong>Payment:</strong> ${escapeHtmlEmail(paymentLabel)} (${escapeHtmlEmail(payment.status)})${payment.reference.trim() ? ` · Ref: ${escapeHtmlEmail(payment.reference.trim())}` : ''}</p>
      <p style="margin:4px 0;font-size:14px;"><strong>Delivery:</strong> ${escapeHtmlEmail(delivery.method === 'campus_delivery' ? delivery.location : 'Print Shop Pickup')} (${escapeHtmlEmail(delivery.timeWindow)})</p>
      ${delivery.instructions.trim() ? `<p style="margin:4px 0;font-size:14px;"><strong>Delivery Instructions:</strong> ${escapeHtmlEmail(delivery.instructions.trim())}</p>` : ''}
    </div>

    <p style="font-size:12px;color:#57544e;">The student's uploaded documents and personalized brown envelope label are attached to this email.</p>
  </div>`;
}

async function sendOrderViaEmail(
  order: PrintOrderRecord,
  filePaths: Array<{ filename: string; filePath: string; mimeType: string }>,
  labelPath: string,
  prevAttempts = 0,
): Promise<EmailNotificationMeta> {
  const attempts = prevAttempts + 1;
  const settings = readAdminSettings();
  const recipientEmail = (
    settings.adminNotificationEmail?.trim() ||
    process.env.ADMIN_NOTIFICATION_EMAIL?.trim() ||
    ADMIN_EMAIL
  ).trim();

  if (!/^\S+@\S+\.\S+$/.test(recipientEmail)) {
    return {
      status: 'FAILED',
      lastError: 'Invalid administrator notification email address configured.',
      attempts,
    };
  }

  const subject = `[DEE PRINTS] New Order ${order.orderId} — ${order.customer.fullName} (${order.customer.studentId})`;
  const textBody = buildWhatsAppAdminNotificationText(order);
  const htmlBody = buildOrderEmailHtml(order);

  const labelBytes = fs.existsSync(labelPath) ? fs.readFileSync(labelPath) : null;

  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.trim();
  const resendKey = process.env.RESEND_API_KEY?.trim();

  if (smtpUser && smtpPass) {
    try {
      const port = Number(process.env.SMTP_PORT) || 465;
      const host = process.env.SMTP_HOST?.trim() || 'smtp.gmail.com';
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
      for (const item of filePaths) {
        if (fs.existsSync(item.filePath)) {
          attachments.push({
            filename: item.filename,
            content: fs.readFileSync(item.filePath),
            contentType: item.mimeType,
          });
        }
      }
      if (labelBytes) {
        attachments.push({
          filename: `DEE-PRINTS-Label-${order.orderId}.html`,
          content: labelBytes,
          contentType: 'text/html; charset=utf-8',
        });
      }

      await transporter.sendMail({
        from: process.env.EMAIL_FROM?.trim() || `"DEE PRINTS Studio" <${smtpUser}>`,
        to: recipientEmail,
        subject,
        text: textBody,
        html: htmlBody,
        attachments,
      });

      return {
        status: 'SENT',
        lastError: '',
        attempts,
      };
    } catch (err) {
      return {
        status: 'FAILED',
        lastError: err instanceof Error ? err.message.slice(0, 350) : 'SMTP email dispatch failed.',
        attempts,
      };
    }
  }

  if (resendKey) {
    try {
      const fromAddress = process.env.EMAIL_FROM?.trim() || 'DEE PRINTS <onboarding@resend.dev>';
      const attachments: Array<{ filename: string; content: string }> = [];
      for (const item of filePaths) {
        if (fs.existsSync(item.filePath)) {
          attachments.push({
            filename: item.filename,
            content: fs.readFileSync(item.filePath).toString('base64'),
          });
        }
      }
      if (labelBytes) {
        attachments.push({
          filename: `DEE-PRINTS-Label-${order.orderId}.html`,
          content: labelBytes.toString('base64'),
        });
      }

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [recipientEmail],
          subject,
          text: textBody,
          html: htmlBody,
          attachments,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        return {
          status: 'FAILED',
          lastError: `Resend API error: ${errText.slice(0, 320)}`,
          attempts,
        };
      }

      return {
        status: 'SENT',
        lastError: '',
        attempts,
      };
    } catch (err) {
      return {
        status: 'FAILED',
        lastError: err instanceof Error ? err.message.slice(0, 350) : 'Email API request failed.',
        attempts,
      };
    }
  }

  return {
    status: 'FAILED',
    lastError:
      'Email transport credentials (SMTP_USER / SMTP_PASS Gmail App Password or RESEND_API_KEY) are not configured on the server.',
    attempts,
  };
}

async function verifyAdminBearer(
  req: express.Request,
): Promise<{ ok: true; email: string } | { ok: false; status: number; error: string }> {
  const authHeader = req.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) {
    return { ok: false, status: 401, error: 'Missing Authorization Bearer token.' };
  }
  const idToken = match[1].trim();
  if (!FIREBASE_WEB_API_KEY) {
    return { ok: false, status: 500, error: 'Firebase Web API key is unavailable on server.' };
  }

  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      },
    );
    if (!res.ok) {
      return { ok: false, status: 401, error: 'Invalid or expired Firebase authentication token.' };
    }
    const json = (await res.json()) as {
      users?: Array<{ email?: string; emailVerified?: boolean }>;
    };
    const user = json.users?.[0];
    if (!user || !user.emailVerified || !user.email) {
      return { ok: false, status: 403, error: 'Verified administrator email is required.' };
    }
    if (user.email.toLowerCase() !== ADMIN_EMAIL) {
      return { ok: false, status: 403, error: 'Account is not authorized for DEE PRINTS administration.' };
    }
    return { ok: true, email: user.email };
  } catch {
    return { ok: false, status: 502, error: 'Unable to verify Firebase authentication token.' };
  }
}

async function verifyBotOrAdminBearer(
  req: express.Request,
): Promise<{ ok: true; actor: string } | { ok: false; status: number; error: string }> {
  const authHeader = req.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) {
    return { ok: false, status: 401, error: 'Missing Authorization Bearer token.' };
  }
  const token = match[1].trim();
  const botSecret = process.env.BOT_API_SECRET?.trim();
  if (botSecret && botSecret.length >= 12) {
    const a = Buffer.from(token, 'utf8');
    const b = Buffer.from(botSecret, 'utf8');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { ok: true, actor: 'whatsapp-bot' };
    }
  }
  const adminCheck = await verifyAdminBearer(req);
  if (adminCheck.ok) {
    return { ok: true, actor: adminCheck.email };
  }
  return { ok: false, status: 401, error: 'Unauthorized bot or administrator token.' };
}

function getValidatedOrderPath(orderId: string, filename: string): string | null {
  if (!/^(DEE|LIM)-[A-Z0-9-]+$/.test(orderId)) return null;
  const orderDir = path.resolve(UPLOADS_ROOT, orderId);
  const targetPath = path.resolve(orderDir, path.basename(filename));
  if (!targetPath.startsWith(orderDir + path.sep)) return null;
  return targetPath;
}

function getOrderDiskFilePath(order: PrintOrderRecord, fileId?: string): { filePath: string; filename: string; mimeType: string } | null {
  const orderDir = path.resolve(UPLOADS_ROOT, order.orderId);
  if (order.documents && order.documents.length > 0) {
    const targetDoc = fileId
      ? order.documents.find((d) => d.fileId === fileId)
      : order.documents[0];
    if (targetDoc) {
      const candidate = path.resolve(orderDir, `${targetDoc.fileId}_${path.basename(targetDoc.filename)}`);
      if (candidate.startsWith(orderDir + path.sep) && fs.existsSync(candidate)) {
        return {
          filePath: candidate,
          filename: targetDoc.filename,
          mimeType: targetDoc.mimeType,
        };
      }
    }
  }
  const legacyPdf = getValidatedOrderPath(order.orderId, 'document.pdf');
  if (legacyPdf && fs.existsSync(legacyPdf)) {
    return {
      filePath: legacyPdf,
      filename: order.document.filename,
      mimeType: 'application/pdf',
    };
  }
  return null;
}

function buildQuotationText(order: PrintOrderRecord): string {
  const { pricing, printing, document } = order;
  const cur = pricing.currency;
  const printingCost = pricing.printingCost ?? (pricing.bwCost + pricing.colorCost);
  const packagingCost = pricing.packagingCost ?? pricing.envelopeCost;
  const deliveryFee = pricing.deliveryFee ?? 0;
  const additionalCost = (pricing.additionalServicesCost ?? 0) + (pricing.additionalCharges ?? 0);

  return [
    `Quotation for Order ${order.orderId}`,
    `Pages: ${document.pages} · Copies: ${printing.copies} · Sides: ${printing.sides}`,
    `Printing cost: ${cur} ${printingCost.toLocaleString()}`,
    `Packaging cost (Envelopes + Binding): ${cur} ${packagingCost.toLocaleString()}`,
    `Additional services: ${cur} ${additionalCost.toLocaleString()}`,
    `Delivery fee: ${cur} ${deliveryFee.toLocaleString()}`,
    `Total Order Cost: ${cur} ${pricing.total.toLocaleString()}`,
  ].join('\n');
}

function recalcOrderPricing(order: PrintOrderRecord): void {
  const pricingConfig = readPricingConfig();
  const servicesCatalog = readServicesCatalog();
  order.pricing = calculateDynamicOrderPrice({
    pages: order.document.pages,
    printType: order.printing.printType,
    bwPages: order.printing.bwPages,
    colorPages: order.printing.colorPages,
    sides: order.printing.sides,
    copies: order.printing.copies,
    envelopeQuantity: order.printing.envelopeQuantity,
    finishing: order.printing.finishing,
    deliveryMethod: order.delivery.method,
    selectedServiceIds: order.selectedServices || [],
    servicesCatalog,
    pricingConfig,
    additionalCharges: order.pricing.additionalCharges || 0,
    currency: pricingConfig.currency,
  });
}

async function processUploadedFiles(
  orderId: string,
  baseUrl: string,
  rawFiles: UploadedFilePayload[],
): Promise<{ ok: true; documents: UploadedDocumentItem[]; diskFiles: Array<{ filename: string; filePath: string; mimeType: string }>; totalPages: number; totalBytes: number } | { ok: false; error: string }> {
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    return { ok: false, error: 'Please upload at least one PDF, DOC, or DOCX document.' };
  }
  if (rawFiles.length > MAX_FILES_PER_ORDER) {
    return { ok: false, error: `Maximum ${MAX_FILES_PER_ORDER} files allowed per order.` };
  }

  const orderDir = path.resolve(UPLOADS_ROOT, orderId);
  fs.mkdirSync(orderDir, { recursive: true });

  const documents: UploadedDocumentItem[] = [];
  const diskFiles: Array<{ filename: string; filePath: string; mimeType: string }> = [];
  let totalPages = 0;
  let totalBytes = 0;

  for (let idx = 0; idx < rawFiles.length; idx++) {
    const raw = rawFiles[idx];
    const validated = detectAndValidateDocument(raw);
    if (!validated.ok) {
      fs.rmSync(orderDir, { recursive: true, force: true });
      return { ok: false, error: validated.error };
    }

    let pages = Math.max(1, Math.min(2000, Math.round(Number(raw.pages) || 1)));
    if (validated.extension === 'pdf') {
      try {
        const pdfDoc = await PDFDocument.load(validated.buffer, { ignoreEncryption: true });
        pages = pdfDoc.getPageCount();
      } catch {
        fs.rmSync(orderDir, { recursive: true, force: true });
        return { ok: false, error: `Could not read PDF pages in "${validated.filename}".` };
      }
      if (pages < 1 || pages > 2000) {
        fs.rmSync(orderDir, { recursive: true, force: true });
        return { ok: false, error: `PDF "${validated.filename}" page count must be between 1 and 2000.` };
      }
    }

    const fileId = `file_${idx + 1}_${crypto.randomBytes(2).toString('hex')}`;
    const diskPath = path.resolve(orderDir, `${fileId}_${validated.filename}`);
    if (!diskPath.startsWith(orderDir + path.sep)) {
      return { ok: false, error: 'Invalid file storage path.' };
    }
    fs.writeFileSync(diskPath, validated.buffer);

    if (idx === 0 && validated.extension === 'pdf') {
      // Backwards compatible alias for legacy document.pdf path
      const legacyPath = path.resolve(orderDir, 'document.pdf');
      fs.writeFileSync(legacyPath, validated.buffer);
    }

    const providedUrl =
      typeof raw.firebaseDownloadUrl === 'string' && /^https:\/\//i.test(raw.firebaseDownloadUrl.trim())
        ? raw.firebaseDownloadUrl.trim().slice(0, 600)
        : '';
    const secureDownloadUrl = providedUrl || createSignedUrl(baseUrl, 'document', orderId, fileId);
    documents.push({
      fileId,
      filename: validated.filename,
      mimeType: validated.mimeType,
      extension: validated.extension,
      pages,
      sizeBytes: validated.buffer.byteLength,
      storagePath: String(raw.storagePath || `orders/${orderId}/${validated.filename}`).slice(0, 300),
      secureDownloadUrl,
    });
    diskFiles.push({
      filename: validated.filename,
      filePath: diskPath,
      mimeType: validated.mimeType,
    });
    totalPages += pages;
    totalBytes += validated.buffer.byteLength;
  }

  return { ok: true, documents, diskFiles, totalPages, totalBytes };
}

async function handleConversationalWhatsappMessage(
  senderPhone: string,
  messageText: string,
  baseUrl: string,
): Promise<string> {
  const cleanText = messageText.trim();
  const sessions = readWhatsappSessions();
  const db = readOrdersDb();
  const nowIso = new Date().toISOString();

  // Check if message references a specific order ID (DEE-XXXXXX)
  const orderRefMatch = cleanText.toUpperCase().match(/\b((?:DEE|LIM)-[A-Z0-9-]+)\b/);
  let state = sessions[senderPhone];

  if (orderRefMatch) {
    const foundId = orderRefMatch[1];
    let order = db[foundId];
    const urlMatch = cleanText.match(/https:\/\/firebasestorage\.googleapis\.com\/[^\s]+/i);

    if (!order && urlMatch) {
      const pricingConfig = readPricingConfig();
      const docUrl = urlMatch[0].slice(0, 600);
      order = {
        orderId: foundId,
        clientRequestId: `wa_bridge_${foundId}`,
        submissionMode: 'whatsapp_session',
        status: 'ORDER RECEIVED',
        customer: {
          fullName: 'Pending via WhatsApp',
          studentId: 'Pending',
          institution: 'Pending via WhatsApp',
          department: 'Pending via WhatsApp',
          course: 'Pending via WhatsApp',
          lecturerName: 'Pending via WhatsApp',
          assignmentTitle: 'Uploaded Document',
          whatsappPhone: senderPhone.slice(0, 40),
        },
        document: {
          filename: 'uploaded-document.pdf',
          pages: 1,
          sizeBytes: 1,
          storagePath: `orders/${foundId}/uploaded-document.pdf`,
          secureDownloadUrl: docUrl,
        },
        documents: [
          {
            fileId: 'file_1',
            filename: 'uploaded-document.pdf',
            mimeType: 'application/pdf',
            extension: 'pdf',
            pages: 1,
            sizeBytes: 1,
            storagePath: `orders/${foundId}/uploaded-document.pdf`,
            secureDownloadUrl: docUrl,
          },
        ],
        printing: {
          printType: 'bw',
          bwPages: 1,
          colorPages: 0,
          sides: 'single',
          copies: 1,
          paperSize: 'A4',
          finishing: 'none',
          envelopeQuantity: 1,
          notes: '',
        },
        pricing: {
          currency: pricingConfig.currency,
          bwSheets: 1,
          colorSheets: 0,
          bwCost: pricingConfig.bwPagePrice,
          colorCost: 0,
          envelopeCost: pricingConfig.brownEnvelopePrice,
          additionalCharges: 0,
          total: pricingConfig.bwPagePrice + pricingConfig.brownEnvelopePrice,
        },
        payment: {
          method: 'payment_on_delivery',
          status: 'PENDING',
          reference: '',
        },
        delivery: {
          method: 'campus_delivery',
          location: 'Pending via WhatsApp',
          timeWindow: 'Next Available (Urgent / Class Today)',
          instructions: '',
        },
        envelopeLabel: {
          storagePath: `orders/${foundId}/envelope-label.html`,
          secureLabelUrl: '',
          note: '',
        },
        whatsappNotification: { status: 'SENT', lastError: '', attempts: 1 },
        emailNotification: { status: 'PENDING', lastError: '', attempts: 0 },
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    }

    if (!order) {
      return `We could not find Order Reference ${foundId}. Please double-check your reference ID or upload your document on our website.`;
    }
    order.whatsappSession = {
      conversationRef: `wa_${senderPhone.replace(/\D/g, '')}_${foundId}`,
      senderPhone,
      step: 'awaiting_full_name',
      lastMessageAt: nowIso,
    };
    order.updatedAt = nowIso;
    db[foundId] = order;
    writeOrdersDb(db);

    const nextStep: WhatsappConversationState['step'] =
      order.customer.fullName && order.customer.fullName !== 'Pending via WhatsApp'
        ? 'awaiting_copies'
        : 'awaiting_full_name';
    state = { senderPhone, orderId: foundId, step: nextStep, lastMessageAt: nowIso };
    sessions[senderPhone] = state;
    writeWhatsappSessions(sessions);

    const fileList = (order.documents || [order.document])
      .map((d) => `${d.filename} (${d.pages}p)`)
      .join(', ');

    if (nextStep === 'awaiting_copies') {
      return `Hello ${order.customer.fullName}! We received your files for ${foundId}: ${fileList}.\nHow many copies do you need (and should we include a brown envelope or delivery)?`;
    }
    return `Hello from DEE PRINTS! We found your uploaded document(s) for ${foundId}: ${fileList}.\nTo prepare your order, please reply with your Full Name.`;
  }

  if (!state || !db[state.orderId]) {
    return 'Welcome to DEE PRINTS! Please upload your document on our website and tap CONTINUE ON WHATSAPP, or reply with your Order Reference (e.g. DEE-XXXXXX).';
  }

  const order = db[state.orderId];

  switch (state.step) {
    case 'awaiting_full_name':
      order.customer.fullName = cleanText.slice(0, 120);
      order.customer.whatsappPhone = senderPhone.slice(0, 40);
      state.step = 'awaiting_student_id';
      break;
    case 'awaiting_student_id':
      order.customer.studentId = cleanText.slice(0, 60);
      state.step = 'awaiting_institution';
      break;
    case 'awaiting_institution':
      order.customer.institution = cleanText.slice(0, 140);
      state.step = 'awaiting_department';
      break;
    case 'awaiting_department':
      order.customer.department = cleanText.slice(0, 140);
      state.step = 'awaiting_delivery_method';
      break;
    case 'awaiting_delivery_method':
      if (/pick|collect|shop/i.test(cleanText)) {
        order.delivery.method = 'shop_pickup';
        order.delivery.location = 'Print Shop Pickup';
        state.step = 'awaiting_copies';
      } else {
        order.delivery.method = 'campus_delivery';
        state.step = 'awaiting_delivery_location';
      }
      break;
    case 'awaiting_delivery_location':
      order.delivery.location = cleanText.slice(0, 160);
      state.step = 'awaiting_copies';
      break;
    case 'awaiting_copies': {
      const numMatch = cleanText.match(/\d+/);
      if (numMatch) {
        order.printing.copies = Math.min(200, Math.max(1, Number(numMatch[0])));
      }
      if (/colou?r/i.test(cleanText)) {
        order.printing.printType = 'color';
        order.printing.bwPages = 0;
        order.printing.colorPages = order.document.pages;
      }
      if (/double|duplex/i.test(cleanText)) {
        order.printing.sides = 'double';
      }
      recalcOrderPricing(order);
      order.status = 'AWAITING PAYMENT';
      order.quotation = {
        summary: buildQuotationText(order),
        quotedBy: 'WhatsApp Bot',
        quotedAt: nowIso,
        totalAmount: order.pricing.total,
        currency: order.pricing.currency,
      };
      state.step = 'quoted';
      break;
    }
    case 'quoted':
      if (/orange|afrimoney|afri|paid|pay/i.test(cleanText)) {
        order.payment.method = /orange/i.test(cleanText)
          ? 'orange_money'
          : /afri/i.test(cleanText)
            ? 'afri_money'
            : 'payment_on_delivery';
        order.payment.reference = cleanText.slice(0, 120);
      }
      break;
  }

  order.whatsappSession = {
    conversationRef: order.whatsappSession?.conversationRef || `wa_${senderPhone}`,
    senderPhone,
    step: state.step,
    lastMessageAt: nowIso,
  };
  order.updatedAt = nowIso;
  state.lastMessageAt = nowIso;
  db[order.orderId] = order;
  writeOrdersDb(db);
  sessions[senderPhone] = state;
  writeWhatsappSessions(sessions);

  const labelPath = getValidatedOrderPath(order.orderId, 'envelope-label.html');
  if (labelPath) {
    const finishingLabel =
      FINISHING_OPTIONS.find((f) => f.id === order.printing.finishing)?.label || order.printing.finishing;
    fs.writeFileSync(
      labelPath,
      buildEnvelopeLabelHtml({
        orderId: order.orderId,
        customer: order.customer,
        copies: order.printing.copies,
        finishingLabel,
        envelopeQuantity: order.printing.envelopeQuantity,
        note: order.envelopeLabel.note,
      }),
      'utf8',
    );
  }

  switch (state.step) {
    case 'awaiting_student_id':
      return 'Thanks! What is your Student ID?';
    case 'awaiting_institution':
      return 'Got it. Which school or university do you attend?';
    case 'awaiting_department':
      return 'Which department or faculty are you in?';
    case 'awaiting_delivery_method':
      return 'Would you prefer Campus Delivery or Print Shop Pickup?';
    case 'awaiting_delivery_location':
      return 'Please reply with your delivery location (campus gate, building, or hostel address).';
    case 'awaiting_copies':
      return 'How many copies do you want printed, and do you prefer Black & White or Colour?';
    case 'quoted':
      return `${buildQuotationText(order)}\n\nTrack your order anytime at: ${baseUrl}/track?ref=${order.orderId}\nReply with Orange Money, Afrimoney, or Payment on Delivery to proceed.`;
    default:
      return `Order ${order.orderId} updated. Track progress at ${baseUrl}/track?ref=${order.orderId}`;
  }
}

async function startServer() {
  ensureUploadsDir();
  const app = express();
  app.set('trust proxy', true);
  app.use(
    express.json({
      limit: '85mb',
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'dee-prints',
      whatsappApiConfigured: Boolean(
        process.env.WHATSAPP_ACCESS_TOKEN?.trim() &&
          process.env.WHATSAPP_PHONE_NUMBER_ID?.trim(),
      ),
      emailApiConfigured: isEmailConfigured(),
    });
  });

  // Public storefront pricing config + services catalog
  app.get('/api/settings/public', (_req, res) => {
    return res.json({
      pricingConfig: readPricingConfig(),
      services: readServicesCatalog(),
    });
  });

  // Upload-only / partial session endpoint for "CONTINUE ON WHATSAPP"
  app.post('/api/upload-session', async (req, res) => {
    let clientRequestId = '';
    try {
      const body = req.body as Partial<UploadSessionPayload>;
      clientRequestId = String(body.clientRequestId || '').trim().slice(0, 80);

      if (!clientRequestId || clientRequestId.length < 8) {
        return res.status(400).json({ error: 'Missing valid clientRequestId.' });
      }

      const existingDb = readOrdersDb();
      const duplicate = Object.values(existingDb).find((o) => o.clientRequestId === clientRequestId);
      const baseUrl = getBaseUrl(req);
      if (duplicate) {
        return res.status(200).json({
          order: duplicate,
          orderViewUrl: createSignedUrl(baseUrl, 'order', duplicate.orderId),
          whatsappContinueUrl: `${baseUrl}/api/dispatch/whatsapp/${encodeURIComponent(duplicate.orderId)}`,
          trackUrl: `${baseUrl}/track?ref=${encodeURIComponent(duplicate.orderId)}`,
          duplicatePrevented: true,
        });
      }

      if (inFlightRequestIds.has(clientRequestId)) {
        return res.status(409).json({ error: 'Upload session creation is already in progress.' });
      }
      inFlightRequestIds.add(clientRequestId);

      const preferred =
        typeof body.preferredOrderId === 'string' &&
        /^(DEE|LIM)-[A-Z0-9-]+$/.test(body.preferredOrderId.trim().toUpperCase())
          ? body.preferredOrderId.trim().toUpperCase()
          : '';
      let orderId = '';
      if (preferred && !existingDb[preferred]) {
        orderId = preferred;
      } else {
        do {
          orderId = `DEE-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        } while (existingDb[orderId]);
      }

      const processed = await processUploadedFiles(orderId, baseUrl, body.files || []);
      if (!processed.ok) {
        return res.status(400).json({ error: processed.error });
      }

      const pricingConfig = readPricingConfig();
      const servicesCatalog = readServicesCatalog();

      const c = body.customer || {};
      const sanitizedCustomer = {
        fullName: String(c.fullName || 'Pending via WhatsApp').trim().slice(0, 120) || 'Pending via WhatsApp',
        studentId: String(c.studentId || 'Pending').trim().slice(0, 60) || 'Pending',
        institution: String(c.institution || 'Pending via WhatsApp').trim().slice(0, 140) || 'Pending via WhatsApp',
        department: String(c.department || 'Pending via WhatsApp').trim().slice(0, 140) || 'Pending via WhatsApp',
        course: String(c.course || 'Pending via WhatsApp').trim().slice(0, 140) || 'Pending via WhatsApp',
        lecturerName: String(c.lecturerName || 'Pending via WhatsApp').trim().slice(0, 120) || 'Pending via WhatsApp',
        assignmentTitle:
          String(c.assignmentTitle || processed.documents[0].filename).trim().slice(0, 180) ||
          processed.documents[0].filename,
        whatsappPhone: String(c.whatsappPhone || 'WhatsApp').trim().slice(0, 40) || 'WhatsApp',
        ...(c.altPhone ? { altPhone: String(c.altPhone).trim().slice(0, 40) } : {}),
      };

      const p = body.printing || {};
      const printType = p.printType && ['bw', 'color', 'mixed'].includes(p.printType) ? p.printType : 'bw';
      const copies = Math.min(200, Math.max(1, Math.round(Number(p.copies) || 1)));
      const sides = p.sides === 'double' ? 'double' : 'single';
      const envelopeQuantity = Math.min(200, Math.max(0, Math.round(Number(p.envelopeQuantity) ?? 1)));
      const finishing = FINISHING_OPTIONS.some((f) => f.id === p.finishing) ? p.finishing! : 'none';
      const bwPages =
        printType === 'bw'
          ? processed.totalPages
          : printType === 'color'
            ? 0
            : Math.min(processed.totalPages, Math.max(0, Math.round(Number(p.bwPages) || 0)));
      const colorPages = printType === 'bw' ? 0 : Math.max(0, processed.totalPages - bwPages);

      const selectedServices = Array.isArray(body.selectedServices)
        ? body.selectedServices.map((s) => String(s).slice(0, 60)).slice(0, 30)
        : [];
      const deliveryMethod =
        body.delivery?.method === 'shop_pickup' ? 'shop_pickup' : 'campus_delivery';

      const pricing = calculateDynamicOrderPrice({
        pages: processed.totalPages,
        printType,
        bwPages,
        colorPages,
        sides,
        copies,
        envelopeQuantity,
        finishing,
        deliveryMethod,
        selectedServiceIds: selectedServices,
        servicesCatalog,
        pricingConfig,
        additionalCharges: 0,
        currency: pricingConfig.currency,
      });

      const envelopeNote = String(body.envelopeNote || '').trim().slice(0, 240);
      const finishingLabel =
        FINISHING_OPTIONS.find((f) => f.id === finishing)?.label || finishing;
      const envelopeHtml = buildEnvelopeLabelHtml({
        orderId,
        customer: sanitizedCustomer,
        copies,
        finishingLabel,
        envelopeQuantity,
        note: envelopeNote,
      });
      const labelDest = path.resolve(UPLOADS_ROOT, orderId, 'envelope-label.html');
      fs.writeFileSync(labelDest, envelopeHtml, 'utf8');

      const nowIso = new Date().toISOString();
      const firstDoc = processed.documents[0];
      const summaryFilename =
        processed.documents.length > 1
          ? `${firstDoc.filename} (+${processed.documents.length - 1} more)`
          : firstDoc.filename;

      const record: PrintOrderRecord = {
        orderId,
        clientRequestId,
        submissionMode: 'whatsapp_session',
        status: 'ORDER RECEIVED',
        customer: sanitizedCustomer,
        document: {
          filename: summaryFilename.slice(0, 180),
          pages: processed.totalPages,
          sizeBytes: processed.totalBytes,
          storagePath: firstDoc.storagePath,
          secureDownloadUrl: firstDoc.secureDownloadUrl,
        },
        documents: processed.documents,
        selectedServices,
        printing: {
          printType,
          bwPages,
          colorPages,
          sides,
          copies,
          paperSize: 'A4',
          finishing,
          envelopeQuantity,
          notes: String(p.notes || '').trim().slice(0, 400),
        },
        pricing,
        payment: {
          method: 'payment_on_delivery',
          status: 'PENDING',
          reference: '',
        },
        delivery: {
          method: deliveryMethod,
          location: String(body.delivery?.location || 'Pending via WhatsApp').trim().slice(0, 160),
          timeWindow: String(body.delivery?.timeWindow || 'Next Available (Urgent / Class Today)').trim().slice(0, 100),
          instructions: String(body.delivery?.instructions || '').trim().slice(0, 400),
        },
        envelopeLabel: {
          storagePath: `orders/${orderId}/envelope-label.html`,
          secureLabelUrl:
            typeof body.labelDownloadUrl === 'string' && /^https:\/\//i.test(body.labelDownloadUrl.trim())
              ? body.labelDownloadUrl.trim().slice(0, 600)
              : createSignedUrl(baseUrl, 'label', orderId),
          note: envelopeNote,
        },
        whatsappNotification: {
          status: 'PENDING',
          lastError: '',
          attempts: 0,
        },
        emailNotification: {
          status: 'PENDING',
          lastError: '',
          attempts: 0,
        },
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      // Dispatch email to admin with uploaded files attached when credentials exist
      if (isEmailConfigured()) {
        record.emailNotification = await sendOrderViaEmail(record, processed.diskFiles, labelDest, 0);
      }

      existingDb[orderId] = record;
      writeOrdersDb(existingDb);

      const adminWaSettings = readAdminSettings();
      const rawWaNum = adminWaSettings.adminWhatsappNumbers[0] || DEFAULT_BUSINESS_WA;
      const waRecipient = rawWaNum.startsWith('0') ? `232${rawWaNum.slice(1)}` : rawWaNum;
      const waMessage = [
        'Hello Dee Prints. I want to place a printing order.',
        '',
        `Order Reference: ${orderId}`,
        `Documents: ${processed.documents.map((d) => `${d.filename} (${d.pages}p) - ${d.secureDownloadUrl}`).join('\n')}`,
        '',
        'I have uploaded my document through your website. Please help me complete my order.',
      ].join('\n');

      return res.status(201).json({
        order: record,
        orderViewUrl: createSignedUrl(baseUrl, 'order', orderId),
        whatsappContinueUrl: `https://wa.me/${waRecipient}?text=${encodeURIComponent(waMessage)}`,
        trackUrl: `${baseUrl}/track?ref=${encodeURIComponent(orderId)}`,
        envelopeHtml,
      });
    } catch (err) {
      console.error('Upload session failed:', err);
      return res.status(500).json({ error: 'Could not save uploaded document session.' });
    } finally {
      if (clientRequestId) {
        inFlightRequestIds.delete(clientRequestId);
      }
    }
  });

  // Full 1-click web checkout submission (with Student Details, Brown Envelope, Payment, Email & Cloud API)
  app.post('/api/orders', async (req, res) => {
    let clientRequestId = '';
    try {
      const body = req.body as Partial<SubmitOrderPayload>;
      clientRequestId = String(body.clientRequestId || '').trim().slice(0, 80);

      if (!clientRequestId || clientRequestId.length < 8) {
        return res.status(400).json({ error: 'Missing valid clientRequestId for duplicate protection.' });
      }

      const existingDb = readOrdersDb();
      const duplicate = Object.values(existingDb).find((o) => o.clientRequestId === clientRequestId);
      const baseUrl = getBaseUrl(req);
      if (duplicate) {
        return res.status(200).json({
          order: duplicate,
          orderViewUrl: createSignedUrl(baseUrl, 'order', duplicate.orderId),
          whatsappContinueUrl: `${baseUrl}/api/dispatch/whatsapp/${encodeURIComponent(duplicate.orderId)}`,
          whatsappMessageText: buildWhatsAppAdminNotificationText(duplicate),
          envelopeHtml: fs.existsSync(getValidatedOrderPath(duplicate.orderId, 'envelope-label.html') || '')
            ? fs.readFileSync(getValidatedOrderPath(duplicate.orderId, 'envelope-label.html')!, 'utf8')
            : '',
          duplicatePrevented: true,
        });
      }

      if (inFlightRequestIds.has(clientRequestId)) {
        return res.status(409).json({ error: 'This order submission is already in progress.' });
      }
      inFlightRequestIds.add(clientRequestId);

      // 1. Validate Customer Details
      const c = body.customer;
      if (
        !c?.fullName?.trim() ||
        !c?.studentId?.trim() ||
        !c?.institution?.trim() ||
        !c?.department?.trim() ||
        !c?.course?.trim() ||
        !c?.lecturerName?.trim() ||
        !c?.assignmentTitle?.trim() ||
        !c?.whatsappPhone?.trim()
      ) {
        return res.status(400).json({
          error: 'Please complete all customer and academic fields (Name, Student ID, Institution, Department, Course, Lecturer, Assignment Title, and WhatsApp phone).',
        });
      }

      // 2. Collect files (supports multi-file array OR legacy single pdfBase64)
      const incomingFiles: UploadedFilePayload[] =
        Array.isArray(body.files) && body.files.length > 0
          ? body.files
          : body.pdfBase64
            ? [
                {
                  fileBase64: body.pdfBase64,
                  filename: body.pdfFilename || 'assignment.pdf',
                  mimeType: 'application/pdf',
                  sizeBytes: Number(body.pdfSizeBytes) || 0,
                  storagePath: body.storagePath,
                },
              ]
            : [];

      if (incomingFiles.length === 0) {
        return res.status(400).json({ error: 'Please upload at least one PDF, DOC, or DOCX document before submitting.' });
      }

      const p = body.printing;
      if (!p || !['bw', 'color', 'mixed'].includes(p.printType)) {
        return res.status(400).json({ error: 'Invalid printing type selected.' });
      }

      const allowedPayments = new Set<PaymentMethod>([
        'orange_money',
        'afri_money',
        'payment_on_delivery',
      ]);
      if (!body.payment?.method || !allowedPayments.has(body.payment.method)) {
        return res.status(400).json({
          error: 'Please choose Orange Money, Africell Money (Afrimoney), or Payment on Delivery.',
        });
      }

      // 3. Generate unique Order ID (or honor preferredOrderId) and validate & save files
      const preferredOrder =
        typeof body.preferredOrderId === 'string' &&
        /^(DEE|LIM)-[A-Z0-9-]+$/.test(body.preferredOrderId.trim().toUpperCase())
          ? body.preferredOrderId.trim().toUpperCase()
          : '';
      let orderId = '';
      if (preferredOrder && !existingDb[preferredOrder]) {
        orderId = preferredOrder;
      } else {
        do {
          orderId = `DEE-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        } while (existingDb[orderId]);
      }

      const processed = await processUploadedFiles(orderId, baseUrl, incomingFiles);
      if (!processed.ok) {
        return res.status(400).json({ error: processed.error });
      }

      const copies = Math.min(200, Math.max(1, Math.round(Number(p.copies) || 1)));
      const sides = p.sides === 'double' ? 'double' : 'single';
      const envelopeQuantity = Math.min(200, Math.max(0, Math.round(Number(p.envelopeQuantity) || 0)));
      const finishing = FINISHING_OPTIONS.some((f) => f.id === p.finishing) ? p.finishing : 'none';

      let bwPages = 0;
      let colorPages = 0;
      if (p.printType === 'bw') {
        bwPages = processed.totalPages;
      } else if (p.printType === 'color') {
        colorPages = processed.totalPages;
      } else {
        bwPages = Math.min(processed.totalPages, Math.max(0, Math.round(Number(p.bwPages) || 0)));
        colorPages = Math.max(0, processed.totalPages - bwPages);
      }

      const sanitizedCustomer = {
        fullName: c.fullName.trim().slice(0, 120),
        studentId: c.studentId.trim().slice(0, 60),
        institution: c.institution.trim().slice(0, 140),
        department: c.department.trim().slice(0, 140),
        course: c.course.trim().slice(0, 140),
        lecturerName: c.lecturerName.trim().slice(0, 120),
        assignmentTitle: c.assignmentTitle.trim().slice(0, 180),
        whatsappPhone: c.whatsappPhone.trim().slice(0, 40),
        ...(c.altPhone?.trim() ? { altPhone: c.altPhone.trim().slice(0, 40) } : {}),
      };

      const finishingLabel =
        FINISHING_OPTIONS.find((f) => f.id === finishing)?.label || finishing;
      const envelopeNote = String(body.envelopeNote || '').trim().slice(0, 240);

      const envelopeHtml = buildEnvelopeLabelHtml({
        orderId,
        customer: sanitizedCustomer,
        copies,
        finishingLabel,
        envelopeQuantity,
        note: envelopeNote,
      });
      const labelDest = path.resolve(UPLOADS_ROOT, orderId, 'envelope-label.html');
      fs.writeFileSync(labelDest, envelopeHtml, 'utf8');

      // 4. Calculate authoritative dynamic server pricing from Admin Pricing Config
      const pricingConfig = readPricingConfig();
      const servicesCatalog = readServicesCatalog();
      const selectedServices = Array.isArray(body.selectedServices)
        ? body.selectedServices.map((s) => String(s).slice(0, 60)).slice(0, 30)
        : [];
      const deliveryMethod =
        body.delivery?.method === 'shop_pickup' ? 'shop_pickup' : 'campus_delivery';

      const pricing = calculateDynamicOrderPrice({
        pages: processed.totalPages,
        printType: p.printType,
        bwPages,
        colorPages,
        sides,
        copies,
        envelopeQuantity,
        finishing,
        deliveryMethod,
        selectedServiceIds: selectedServices,
        servicesCatalog,
        pricingConfig,
        additionalCharges: 0,
        currency: String(body.currency || pricingConfig.currency).trim().slice(0, 12) || pricingConfig.currency,
      });

      const firstDoc = processed.documents[0];
      const summaryFilename =
        processed.documents.length > 1
          ? `${firstDoc.filename} (+${processed.documents.length - 1} more)`
          : firstDoc.filename;

      const secureLabelUrl =
        typeof body.labelDownloadUrl === 'string' && /^https:\/\//i.test(body.labelDownloadUrl.trim())
          ? body.labelDownloadUrl.trim().slice(0, 600)
          : createSignedUrl(baseUrl, 'label', orderId);
      const nowIso = new Date().toISOString();

      const record: PrintOrderRecord = {
        orderId,
        clientRequestId,
        submissionMode: 'web_checkout',
        status: 'ORDER RECEIVED',
        customer: sanitizedCustomer,
        document: {
          filename: summaryFilename.slice(0, 180),
          pages: processed.totalPages,
          sizeBytes: processed.totalBytes,
          storagePath: firstDoc.storagePath,
          secureDownloadUrl: firstDoc.secureDownloadUrl,
        },
        documents: processed.documents,
        selectedServices,
        printing: {
          printType: p.printType,
          bwPages,
          colorPages,
          sides,
          copies,
          paperSize: 'A4',
          finishing,
          envelopeQuantity,
          notes: String(p.notes || '').trim().slice(0, 400),
        },
        pricing,
        payment: {
          method: body.payment.method,
          status: 'PENDING',
          reference: String(body.payment.reference || '').trim().slice(0, 120),
        },
        delivery: {
          method: deliveryMethod,
          location: String(body.delivery?.location || 'Main Campus Gate').trim().slice(0, 160),
          timeWindow: String(body.delivery?.timeWindow || 'Next Available (Urgent / Class Today)').trim().slice(0, 100),
          instructions: String(body.delivery?.instructions || '').trim().slice(0, 400),
        },
        envelopeLabel: {
          storagePath: String(body.labelStoragePath || `orders/${orderId}/envelope-label.html`).slice(0, 300),
          secureLabelUrl,
          note: envelopeNote,
        },
        whatsappNotification: {
          status: 'PENDING',
          lastError: '',
          attempts: 0,
        },
        emailNotification: {
          status: 'PENDING',
          lastError: '',
          attempts: 0,
        },
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const [notifyResult, emailResult] = await Promise.all([
        sendOrderViaWhatsAppCloudApi(record, processed.diskFiles[0].filePath, 0),
        sendOrderViaEmail(record, processed.diskFiles, labelDest, 0),
      ]);
      record.whatsappNotification = notifyResult;
      record.emailNotification = emailResult;

      existingDb[orderId] = record;
      writeOrdersDb(existingDb);

      const adminWaSettings = readAdminSettings();
      const rawWaNum = adminWaSettings.adminWhatsappNumbers[0] || DEFAULT_BUSINESS_WA;
      const waRecipient = rawWaNum.startsWith('0') ? `232${rawWaNum.slice(1)}` : rawWaNum;
      const directWaMessage = buildWhatsAppAdminNotificationText(record);

      return res.status(201).json({
        order: record,
        orderViewUrl: createSignedUrl(baseUrl, 'order', orderId),
        whatsappContinueUrl: `https://wa.me/${waRecipient}?text=${encodeURIComponent(directWaMessage)}`,
        trackUrl: `${baseUrl}/track?ref=${encodeURIComponent(orderId)}`,
        whatsappMessageText: directWaMessage,
        envelopeHtml,
      });
    } catch (err) {
      console.error('Failed to process order:', err);
      return res.status(500).json({ error: 'Unable to submit print order. Please try again.' });
    } finally {
      if (clientRequestId) {
        inFlightRequestIds.delete(clientRequestId);
      }
    }
  });

  // Direct "ORDER ON WHATSAPP" click-to-chat redirect (no info stored on website)
  app.get('/api/dispatch/whatsapp', (_req, res) => {
    const settings = readAdminSettings();
    const rawNum = settings.adminWhatsappNumbers[0] || DEFAULT_BUSINESS_WA;
    const recipient = rawNum.startsWith('0') ? `232${rawNum.slice(1)}` : rawNum;
    const message = [
      'Hello DEE PRINTS! I want to place a printing order.',
      '',
      'I am ready to send my document/PDF and printing instructions here.',
    ].join('\n');
    return res.redirect(302, `https://wa.me/${recipient}?text=${encodeURIComponent(message)}`);
  });

  // Opaque "CONTINUE ON WHATSAPP" click-to-chat redirect (never exposes phone number in frontend JS)
  app.get('/api/dispatch/whatsapp/:orderId', (req, res) => {
    const { orderId } = req.params;
    if (!/^(DEE|LIM)-[A-Z0-9-]+$/.test(orderId)) {
      return res.status(400).send('Invalid order reference.');
    }
    const db = readOrdersDb();
    const order = db[orderId];
    if (!order) {
      return res.status(404).send('Order session not found.');
    }

    const settings = readAdminSettings();
    const rawNum = settings.adminWhatsappNumbers[0] || DEFAULT_BUSINESS_WA;
    const recipient = rawNum.startsWith('0') ? `232${rawNum.slice(1)}` : rawNum;

    const hasCustomerDetails =
      Boolean(order.customer.fullName) &&
      order.customer.fullName !== 'Pending via WhatsApp';
    const docCount = order.documents?.length || 1;
    const paymentLabel =
      PAYMENT_OPTIONS.find((p) => p.id === order.payment.method)?.label ||
      order.payment.method;
    const finishingLabel =
      FINISHING_OPTIONS.find((f) => f.id === order.printing.finishing)?.label ||
      order.printing.finishing;

    const lines = [
      'Hello Dee Prints. I want to place a printing order.',
      '',
      `My order reference is: ${order.orderId}.`,
      '',
      `Documents: ${docCount} file(s) (${order.document.pages} page${order.document.pages === 1 ? '' : 's'})`,
      `Print Spec: ${order.printing.copies}x · ${order.printing.printType.toUpperCase()} · ${order.printing.sides}-sided · ${finishingLabel}`,
      `Estimated Total: ${order.pricing.currency} ${order.pricing.total.toLocaleString()}`,
    ];

    if (hasCustomerDetails) {
      lines.push(
        `Student: ${order.customer.fullName}${order.customer.studentId && order.customer.studentId !== 'Pending' ? ` (${order.customer.studentId})` : ''}`,
      );
      if (order.customer.institution && order.customer.institution !== 'Pending via WhatsApp') {
        lines.push(`Institution: ${order.customer.institution}`);
      }
      if (order.customer.course && order.customer.course !== 'Pending via WhatsApp') {
        lines.push(`Course: ${order.customer.course}`);
      }
      lines.push(
        `Delivery: ${order.delivery.method === 'shop_pickup' ? 'Print Shop Collection' : `Campus Delivery (${order.delivery.location})`}`,
      );
      lines.push(`Payment: ${paymentLabel}`);
      if (order.payment.reference) {
        lines.push(`Payment Ref: ${order.payment.reference}`);
      }
    }

    lines.push(
      '',
      'I have uploaded my document through your website. Please help me complete my order.',
    );

    const waUrl = `https://wa.me/${recipient}?text=${encodeURIComponent(lines.join('\n'))}`;
    return res.redirect(302, waUrl);
  });

  // Sanitized public order status tracking endpoint (never leaks PII or raw document links)
  app.get('/api/track/:orderId', (req, res) => {
    const orderId = String(req.params.orderId || '').trim().toUpperCase();
    if (!/^(DEE|LIM)-[A-Z0-9-]+$/.test(orderId)) {
      return res.status(400).json({ error: 'Please enter a valid DEE PRINTS order reference (e.g. DEE-XXXXXX).' });
    }
    const db = readOrdersDb();
    const order = db[orderId];
    if (!order) {
      return res.status(404).json({ error: `Order ${orderId} was not found. Please verify your reference number.` });
    }

    const servicesCatalog = readServicesCatalog();
    const selectedServiceNames = (order.selectedServices || []).map(
      (id) => servicesCatalog.find((s) => s.id === id)?.name || id,
    );

    return res.json({
      orderId: order.orderId,
      status: normalizeOrderStatus(order.status),
      rawStatus: order.status,
      submissionMode: order.submissionMode || 'web_checkout',
      documentCount: order.documents?.length || 1,
      totalPages: order.document.pages,
      copies: order.printing.copies,
      sides: order.printing.sides,
      printType: order.printing.printType,
      finishing:
        FINISHING_OPTIONS.find((f) => f.id === order.printing.finishing)?.label ||
        order.printing.finishing,
      selectedServiceNames,
      deliveryMethod: order.delivery.method,
      pricingSummary: {
        currency: order.pricing.currency,
        printingCost:
          order.pricing.printingCost ?? (order.pricing.bwCost + order.pricing.colorCost),
        packagingCost: order.pricing.packagingCost ?? order.pricing.envelopeCost,
        deliveryFee: order.pricing.deliveryFee ?? 0,
        additionalServicesCost: order.pricing.additionalServicesCost ?? 0,
        additionalCharges: order.pricing.additionalCharges ?? 0,
        total: order.pricing.total,
      },
      quotation: order.quotation || null,
      paymentStatus: order.payment.status,
      paymentMethod:
        PAYMENT_OPTIONS.find((p) => p.id === order.payment.method)?.label ||
        order.payment.method,
      whatsappLinked: Boolean(order.whatsappSession?.conversationRef),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    });
  });

  // Meta WhatsApp Cloud API Webhook (GET verification + POST incoming conversational messages)
  app.get('/api/whatsapp/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = typeof req.query['hub.verify_token'] === 'string' ? req.query['hub.verify_token'] : '';
    const challenge = req.query['hub.challenge'];
    const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim() || '';

    if (mode === 'subscribe' && expectedToken && token) {
      const a = Buffer.from(token, 'utf8');
      const b = Buffer.from(expectedToken, 'utf8');
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        return res.status(200).send(String(challenge || ''));
      }
    }
    return res.status(403).json({ error: 'Webhook verification failed.' });
  });

  app.post('/api/whatsapp/webhook', async (req, res) => {
    const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
    if (!appSecret) {
      return res.status(503).json({ error: 'WhatsApp webhook secret (WHATSAPP_APP_SECRET) is not configured.' });
    }
    const signature = req.get('x-hub-signature-256') || '';
    const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody || !signature.startsWith('sha256=')) {
      return res.status(401).json({ error: 'Missing X-Hub-Signature-256 header.' });
    }
    const expectedSig = `sha256=${crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex')}`;
    const a = Buffer.from(signature, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'Invalid webhook signature.' });
    }

    const baseUrl = getBaseUrl(req);
    const body = req.body as {
      entry?: Array<{
        changes?: Array<{
          value?: {
            messages?: Array<{
              from?: string;
              type?: string;
              text?: { body?: string };
            }>;
          };
        }>;
      }>;
    };

    const replies: Array<{ to: string; reply: string }> = [];
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        for (const msg of change.value?.messages || []) {
          if (msg.from && msg.type === 'text' && msg.text?.body) {
            const replyText = await handleConversationalWhatsappMessage(
              msg.from,
              msg.text.body,
              baseUrl,
            );
            replies.push({ to: msg.from, reply: replyText });
            void sendTextViaWhatsAppCloudApi(msg.from, replyText);
          }
        }
      }
    }

    return res.status(200).json({ received: true, replies });
  });

  // Authenticated WhatsApp Bot Bridge API (/api/bot/*)
  app.get('/api/bot/orders/:orderId', async (req, res) => {
    const authCheck = await verifyBotOrAdminBearer(req);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({ error: authCheck.error });
    }
    const { orderId } = req.params;
    const db = readOrdersDb();
    const order = db[orderId];
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    return res.json({
      order,
      pricingConfig: readPricingConfig(),
      services: readServicesCatalog(),
      quotationText: buildQuotationText(order),
    });
  });

  app.get('/api/bot/orders/:orderId/documents/:fileId', async (req, res) => {
    const authCheck = await verifyBotOrAdminBearer(req);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({ error: authCheck.error });
    }
    const { orderId, fileId } = req.params;
    const db = readOrdersDb();
    const order = db[orderId];
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    const fileInfo = getOrderDiskFilePath(order, fileId === 'primary' ? undefined : fileId);
    if (!fileInfo) {
      return res.status(404).json({ error: 'Document not found.' });
    }
    const safeName = path.basename(fileInfo.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', fileInfo.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    return res.sendFile(fileInfo.filePath);
  });

  app.patch('/api/bot/orders/:orderId', async (req, res) => {
    const authCheck = await verifyBotOrAdminBearer(req);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({ error: authCheck.error });
    }
    const { orderId } = req.params;
    const db = readOrdersDb();
    const order = db[orderId];
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const patch = req.body as {
      customer?: Partial<PrintOrderRecord['customer']>;
      printing?: Partial<PrintOrderRecord['printing']>;
      delivery?: Partial<PrintOrderRecord['delivery']>;
      selectedServices?: string[];
      status?: OrderStatus;
      whatsappSession?: PrintOrderRecord['whatsappSession'];
    };

    if (patch.customer) {
      order.customer = {
        ...order.customer,
        ...patch.customer,
      };
    }
    if (patch.printing) {
      order.printing = {
        ...order.printing,
        ...patch.printing,
      };
    }
    if (patch.delivery) {
      order.delivery = {
        ...order.delivery,
        ...patch.delivery,
      };
    }
    if (Array.isArray(patch.selectedServices)) {
      order.selectedServices = patch.selectedServices.map((s) => String(s).slice(0, 60)).slice(0, 30);
    }
    if (patch.whatsappSession) {
      order.whatsappSession = patch.whatsappSession;
    }
    if (patch.status) {
      order.status = normalizeOrderStatus(patch.status);
    }

    recalcOrderPricing(order);
    order.updatedAt = new Date().toISOString();
    db[orderId] = order;
    writeOrdersDb(db);

    return res.json({ order, quotationText: buildQuotationText(order) });
  });

  app.post('/api/bot/orders/:orderId/quote', async (req, res) => {
    const authCheck = await verifyBotOrAdminBearer(req);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({ error: authCheck.error });
    }
    const { orderId } = req.params;
    const db = readOrdersDb();
    const order = db[orderId];
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const body = req.body as { additionalCharges?: number; summary?: string };
    if (typeof body.additionalCharges === 'number') {
      order.pricing.additionalCharges = Math.max(0, body.additionalCharges);
    }
    recalcOrderPricing(order);
    const nowIso = new Date().toISOString();
    order.status = 'AWAITING PAYMENT';
    order.quotation = {
      summary: String(body.summary || buildQuotationText(order)).slice(0, 600),
      quotedBy: authCheck.actor,
      quotedAt: nowIso,
      totalAmount: order.pricing.total,
      currency: order.pricing.currency,
    };
    order.updatedAt = nowIso;
    db[orderId] = order;
    writeOrdersDb(db);

    return res.json({ order, quotation: order.quotation });
  });

  app.post('/api/bot/orders/:orderId/payment-confirm', async (req, res) => {
    const authCheck = await verifyBotOrAdminBearer(req);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({ error: authCheck.error });
    }
    const { orderId } = req.params;
    const db = readOrdersDb();
    const order = db[orderId];
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const body = req.body as { method?: PaymentMethod; reference?: string };
    if (body.method && ['orange_money', 'afri_money', 'payment_on_delivery'].includes(body.method)) {
      order.payment.method = body.method;
    }
    if (typeof body.reference === 'string') {
      order.payment.reference = body.reference.trim().slice(0, 120);
    }
    order.payment.status = 'CONFIRMED';
    order.status = 'PAYMENT CONFIRMED';
    order.updatedAt = new Date().toISOString();
    db[orderId] = order;
    writeOrdersDb(db);

    return res.json({ order });
  });

  // Time-limited HMAC signed document download for WhatsApp Admin notifications & receipt links
  app.get('/api/secure/document/:orderId', (req, res) => {
    const { orderId } = req.params;
    const fileId = typeof req.query.fileId === 'string' ? req.query.fileId : '';
    if (!verifyToken('document', orderId, req.query.exp, req.query.sig, fileId)) {
      return res.status(403).json({ error: 'Invalid or expired document access signature.' });
    }
    const db = readOrdersDb();
    const order = db[orderId];
    if (!order) {
      return res.status(404).send('Order not found.');
    }
    const fileInfo = getOrderDiskFilePath(order, fileId || undefined);
    if (!fileInfo) {
      return res.status(404).send('Document not found.');
    }
    const safeName = path.basename(fileInfo.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', fileInfo.mimeType);
    res.setHeader(
      'Content-Disposition',
      `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${safeName}"`,
    );
    return res.sendFile(fileInfo.filePath);
  });

  // Time-limited HMAC signed envelope label download
  app.get('/api/secure/label/:orderId', (req, res) => {
    const { orderId } = req.params;
    if (!verifyToken('label', orderId, req.query.exp, req.query.sig)) {
      return res.status(403).json({ error: 'Invalid or expired envelope label signature.' });
    }
    const db = readOrdersDb();
    const order = db[orderId];
    const filePath = getValidatedOrderPath(orderId, 'envelope-label.html');
    if (!order || !filePath || !fs.existsSync(filePath)) {
      return res.status(404).send('Envelope label not found.');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="DEE-PRINTS-Label-${orderId}.html"`);
    }
    return res.sendFile(filePath);
  });

  // Order detail endpoint requires either Admin Bearer token OR valid signed view token
  app.get('/api/orders/:orderId', async (req, res) => {
    const { orderId } = req.params;
    if (!/^(DEE|LIM)-[A-Z0-9-]+$/.test(orderId)) {
      return res.status(400).json({ error: 'Invalid order ID.' });
    }

    const hasValidSig = verifyToken('order', orderId, req.query.exp, req.query.sig);
    if (!hasValidSig) {
      const authCheck = await verifyAdminBearer(req);
      if (!authCheck.ok) {
        return res.status(403).json({ error: 'Order sheet access requires administrator sign-in or a valid signed receipt link.' });
      }
    }

    const db = readOrdersDb();
    const record = db[orderId];
    if (!record) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    return res.json({
      order: record,
      whatsappMessageText: buildWhatsAppAdminNotificationText(record),
    });
  });

  // Admin-only orders vault list & status/payment sync (bridges WhatsApp bot updates <-> Firestore Admin)
  app.get('/api/admin/orders', async (req, res) => {
    const authCheck = await verifyAdminBearer(req);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({ error: authCheck.error });
    }
    const db = readOrdersDb();
    const orders = Object.values(db).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return res.json({ orders });
  });

  app.patch('/api/admin/orders/:orderId', async (req, res) => {
    const authCheck = await verifyAdminBearer(req);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({ error: authCheck.error });
    }
    const { orderId } = req.params;
    const db = readOrdersDb();
    const order = db[orderId];
    if (!order) {
      return res.status(404).json({ error: 'Order not found in server vault.' });
    }
    const body = req.body as {
      status?: OrderStatus;
      paymentStatus?: PaymentStatus;
      additionalCharges?: number;
      quotation?: PrintOrderRecord['quotation'];
    };
    if (body.status) {
      order.status = normalizeOrderStatus(body.status);
    }
    if (body.paymentStatus && ['PENDING', 'CONFIRMED', 'FAILED'].includes(body.paymentStatus)) {
      order.payment.status = body.paymentStatus;
    }
    if (typeof body.additionalCharges === 'number') {
      order.pricing.additionalCharges = Math.max(0, body.additionalCharges);
      const baseSubtotal =
        (order.pricing.printingCost ?? (order.pricing.bwCost + order.pricing.colorCost)) +
        (order.pricing.packagingCost ?? order.pricing.envelopeCost) +
        (order.pricing.deliveryFee ?? 0) +
        (order.pricing.additionalServicesCost ?? 0);
      order.pricing.total = Number((baseSubtotal + order.pricing.additionalCharges).toFixed(2));
    }
    if (body.quotation) {
      order.quotation = body.quotation;
      order.pricing.total = body.quotation.totalAmount;
    }
    order.updatedAt = new Date().toISOString();
    db[orderId] = order;
    writeOrdersDb(db);
    return res.json({ order });
  });

  // Admin-only document download (supports ?fileId= for multi-file orders)
  app.get('/api/admin/orders/:orderId/document', async (req, res) => {
    const authCheck = await verifyAdminBearer(req);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({ error: authCheck.error });
    }
    const { orderId } = req.params;
    const fileId = typeof req.query.fileId === 'string' ? req.query.fileId : undefined;
    const db = readOrdersDb();
    const order = db[orderId];
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    const fileInfo = getOrderDiskFilePath(order, fileId);
    if (!fileInfo) {
      return res.status(404).json({ error: 'Order document not found in server vault.' });
    }
    const safeName = path.basename(fileInfo.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', fileInfo.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    return res.sendFile(fileInfo.filePath);
  });

  // Admin-only envelope label download
  app.get('/api/admin/orders/:orderId/label', async (req, res) => {
    const authCheck = await verifyAdminBearer(req);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({ error: authCheck.error });
    }
    const { orderId } = req.params;
    const db = readOrdersDb();
    const order = db[orderId];
    const filePath = getValidatedOrderPath(orderId, 'envelope-label.html');
    if (!order || !filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Envelope label not found.' });
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="DEE-PRINTS-Label-${orderId}.html"`);
    return res.sendFile(filePath);
  });

  // Admin-only WhatsApp notification retry
  app.post('/api/admin/notifications/retry/:orderId', async (req, res) => {
    const authCheck = await verifyAdminBearer(req);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({ error: authCheck.error });
    }
    const { orderId } = req.params;
    const db = readOrdersDb();
    const order = db[orderId];
    if (!order) {
      return res.status(404).json({ error: 'Order not found in server vault for retry.' });
    }
    const fileInfo = getOrderDiskFilePath(order);
    if (!fileInfo) {
      return res.status(404).json({ error: 'Order document not found in server vault.' });
    }
    const nextMeta = await sendOrderViaWhatsAppCloudApi(
      order,
      fileInfo.filePath,
      order.whatsappNotification?.attempts || 0,
    );
    order.whatsappNotification = nextMeta;
    order.updatedAt = new Date().toISOString();
    db[orderId] = order;
    writeOrdersDb(db);
    return res.json(nextMeta);
  });

  // Admin-only Email notification retry
  app.post('/api/admin/email/retry/:orderId', async (req, res) => {
    const authCheck = await verifyAdminBearer(req);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({ error: authCheck.error });
    }
    const { orderId } = req.params;
    const db = readOrdersDb();
    const order = db[orderId];
    const labelPath = getValidatedOrderPath(orderId, 'envelope-label.html');
    if (!order || !labelPath) {
      return res.status(404).json({ error: 'Order not found in server vault for email retry.' });
    }
    const diskFiles = (order.documents || []).map((d) => {
      const resolved = getOrderDiskFilePath(order, d.fileId);
      return resolved ? { filename: resolved.filename, filePath: resolved.filePath, mimeType: resolved.mimeType } : null;
    }).filter((x): x is { filename: string; filePath: string; mimeType: string } => Boolean(x));

    if (diskFiles.length === 0) {
      const legacy = getOrderDiskFilePath(order);
      if (legacy) {
        diskFiles.push({ filename: legacy.filename, filePath: legacy.filePath, mimeType: legacy.mimeType });
      }
    }

    const nextMeta = await sendOrderViaEmail(
      order,
      diskFiles,
      labelPath,
      order.emailNotification?.attempts || 0,
    );
    order.emailNotification = nextMeta;
    order.updatedAt = new Date().toISOString();
    db[orderId] = order;
    writeOrdersDb(db);
    return res.json(nextMeta);
  });

  // Admin-only Pricing Engine Configuration sync
  app.get('/api/admin/pricing', async (req, res) => {
    const authCheck = await verifyAdminBearer(req);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({ error: authCheck.error });
    }
    return res.json(readPricingConfig());
  });

  app.post('/api/admin/pricing', async (req, res) => {
    const authCheck = await verifyAdminBearer(req);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({ error: authCheck.error });
    }
    const body = req.body as Partial<PricingConfig>;
    const nextConfig: PricingConfig = {
      currency: String(body.currency || DEFAULT_CURRENCY).trim().toUpperCase().slice(0, 12) || DEFAULT_CURRENCY,
      bwPagePrice: Math.max(0, Number(body.bwPagePrice) || 0),
      colorPagePrice: Math.max(0, Number(body.colorPagePrice) || 0),
      singleSidedPrice: Math.max(0, Number(body.singleSidedPrice) || 0),
      doubleSidedPrice: Math.max(0, Number(body.doubleSidedPrice) || 0),
      brownEnvelopePrice: Math.max(0, Number(body.brownEnvelopePrice) || 0),
      bindingPrice: Math.max(0, Number(body.bindingPrice) || 0),
      deliveryFee: Math.max(0, Number(body.deliveryFee) || 0),
      additionalServiceCharge: Math.max(0, Number(body.additionalServiceCharge) || 0),
      updatedAt: new Date().toISOString(),
    };
    writePricingConfig(nextConfig);
    return res.json(nextConfig);
  });

  // Admin-only Services Catalog CRUD sync
  app.get('/api/admin/services', async (req, res) => {
    const authCheck = await verifyAdminBearer(req);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({ error: authCheck.error });
    }
    return res.json({ services: readServicesCatalog() });
  });

  app.post('/api/admin/services', async (req, res) => {
    const authCheck = await verifyAdminBearer(req);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({ error: authCheck.error });
    }
    const body = req.body as { services?: PrintingServiceItem[] };
    if (!Array.isArray(body.services)) {
      return res.status(400).json({ error: 'services array is required.' });
    }
    const sanitized = body.services.slice(0, 40).map((s, idx) => ({
      id: String(s.id || `service_${idx + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60),
      name: String(s.name || 'Printing Service').trim().slice(0, 120),
      category: (['printing', 'finishing', 'document', 'delivery'].includes(s.category) ? s.category : 'document') as PrintingServiceItem['category'],
      description: String(s.description || '').trim().slice(0, 300),
      price: Math.max(0, Number(s.price) || 0),
      unitLabel: String(s.unitLabel || 'per order').trim().slice(0, 80),
      enabled: Boolean(s.enabled),
    }));
    writeServicesCatalog(sanitized);
    return res.json({ services: sanitized });
  });

  // Admin-only private WhatsApp & Email settings sync
  app.get('/api/admin/settings', async (req, res) => {
    const authCheck = await verifyAdminBearer(req);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({ error: authCheck.error });
    }
    const settings = readAdminSettings();
    return res.json({
      ...settings,
      whatsappApiConfigured: Boolean(
        process.env.WHATSAPP_ACCESS_TOKEN?.trim() &&
          process.env.WHATSAPP_PHONE_NUMBER_ID?.trim(),
      ),
      emailApiConfigured: isEmailConfigured(),
      botSecretConfigured: Boolean(process.env.BOT_API_SECRET?.trim()),
      webhookVerifyTokenConfigured: Boolean(process.env.WHATSAPP_VERIFY_TOKEN?.trim()),
    });
  });

  app.post('/api/admin/settings', async (req, res) => {
    const authCheck = await verifyAdminBearer(req);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({ error: authCheck.error });
    }
    const body = req.body as Partial<AdminPrivateSettings>;
    const numbers = Array.isArray(body.adminWhatsappNumbers)
      ? body.adminWhatsappNumbers
          .map((n) => {
            const digits = String(n).replace(/\D/g, '');
            return digits.startsWith('0') && digits.length === 9 ? `232${digits.slice(1)}` : digits;
          })
          .filter((n) => n.length >= 7)
          .slice(0, 5)
      : [];
    if (numbers.length === 0) {
      return res.status(400).json({ error: 'Provide at least one valid administrator WhatsApp phone number.' });
    }
    const rawEmail = String(body.adminNotificationEmail || ADMIN_EMAIL).trim().slice(0, 160);
    if (!/^\S+@\S+\.\S+$/.test(rawEmail)) {
      return res.status(400).json({ error: 'Provide a valid administrator notification email address.' });
    }
    const nextSettings: AdminPrivateSettings = {
      adminWhatsappNumbers: numbers,
      whatsappTemplateName: String(body.whatsappTemplateName || '').trim().slice(0, 120),
      whatsappTemplateLanguage: String(body.whatsappTemplateLanguage || 'en_US').trim().slice(0, 20) || 'en_US',
      adminNotificationEmail: rawEmail,
      updatedAt: new Date().toISOString(),
    };
    writeAdminSettings(nextSettings);
    return res.json({
      ...nextSettings,
      whatsappApiConfigured: Boolean(
        process.env.WHATSAPP_ACCESS_TOKEN?.trim() &&
          process.env.WHATSAPP_PHONE_NUMBER_ID?.trim(),
      ),
      emailApiConfigured: isEmailConfigured(),
      botSecretConfigured: Boolean(process.env.BOT_API_SECRET?.trim()),
      webhookVerifyTokenConfigured: Boolean(process.env.WHATSAPP_VERIFY_TOKEN?.trim()),
    });
  });

  // Legacy helper redirect (does not expose recipient number in client HTML/JS)
  app.get('/api/dispatch/quick', (req, res) => {
    const q = (key: string, max = 160) =>
      typeof req.query[key] === 'string' ? req.query[key].trim().slice(0, max) : '';

    const pages = Math.max(1, Number(q('pages', 10)) || 1);
    const copies = Math.max(1, Number(q('copies', 10)) || 1);
    const binding = q('binding', 60);
    const studentName = q('studentName', 120);
    const studentId = q('studentId', 60);
    const course = q('course', 140);

    const lines: string[] = [
      'DEE PRINTS — STUDENT PRINT ASSISTANCE',
      `Pages: ${pages} · Copies: ${copies}`,
    ];
    if (binding) lines.push(`Finishing: ${binding}`);
    if (studentName || studentId) {
      lines.push(`Student: ${[studentName, studentId].filter(Boolean).join(' · ')}`);
    }
    if (course) lines.push(`Course: ${course}`);

    const settings = readAdminSettings();
    const rawNum = settings.adminWhatsappNumbers[0] || DEFAULT_BUSINESS_WA;
    const recipient = rawNum.startsWith('0') ? `232${rawNum.slice(1)}` : rawNum;
    const waUrl = `https://wa.me/${recipient}?text=${encodeURIComponent(lines.join('\n'))}`;
    return res.redirect(302, waUrl);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`DEE PRINTS server listening on http://localhost:${PORT}`);
  });
}

startServer();
