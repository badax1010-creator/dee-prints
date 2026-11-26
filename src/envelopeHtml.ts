import { CustomerDetails } from './types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildEnvelopeLabelHtml(params: {
  orderId: string;
  customer: CustomerDetails;
  copies: number;
  finishingLabel: string;
  envelopeQuantity: number;
  note?: string;
}): string {
  const { orderId, customer, copies, finishingLabel, envelopeQuantity, note } = params;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>DEE PRINTS Envelope Label — ${escapeHtml(orderId)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f3f1ec;
      color: #141413;
    }
    .envelope-sheet {
      max-width: 680px;
      margin: 0 auto;
      background: #dfc9a6;
      border: 2px solid #b89f78;
      border-radius: 12px;
      padding: 32px;
    }
    .top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      font-family: monospace;
      color: #5b4b34;
      margin-bottom: 16px;
    }
    .label-card {
      background: #ffffff;
      border: 1px solid #d4d0c8;
      border-radius: 8px;
      padding: 28px;
    }
    .brand {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      border-bottom: 2px solid #141413;
      padding-bottom: 12px;
      margin-bottom: 18px;
    }
    .brand-title {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .brand-meta {
      font-family: monospace;
      font-size: 12px;
      color: #57544e;
    }
    .row {
      display: flex;
      gap: 12px;
      padding: 7px 0;
      border-bottom: 1px solid #eceae4;
      font-size: 14px;
    }
    .row:last-of-type {
      border-bottom: none;
    }
    .label {
      width: 145px;
      flex-shrink: 0;
      font-weight: 600;
      color: #57544e;
    }
    .value {
      font-weight: 600;
      color: #141413;
      word-break: break-word;
    }
    .footer-note {
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px dashed #d4d0c8;
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #57544e;
    }
    @media print {
      body { background: #ffffff; padding: 0; }
      .envelope-sheet { border: 1px solid #cccccc; background: #ffffff; max-width: 100%; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="max-width:680px;margin:0 auto 16px;display:flex;justify-content:flex-end;">
    <button onclick="window.print()" style="padding:8px 16px;background:#141413;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">
      Print Envelope Label
    </button>
  </div>
  <div class="envelope-sheet">
    <div class="top-bar">
      <span>BROWN ENVELOPE PERSONALIZATION</span>
      <span>${escapeHtml(orderId)} · ${envelopeQuantity} ENVELOPE(S)</span>
    </div>
    <div class="label-card">
      <div class="brand">
        <span class="brand-title">DEE PRINTS</span>
        <span class="brand-meta">${escapeHtml(orderId)} · ${copies} ${copies === 1 ? 'COPY' : 'COPIES'}</span>
      </div>
      <div class="row"><span class="label">Student Name:</span><span class="value">${escapeHtml(customer.fullName)}</span></div>
      <div class="row"><span class="label">Student ID:</span><span class="value">${escapeHtml(customer.studentId)}</span></div>
      <div class="row"><span class="label">Institution:</span><span class="value">${escapeHtml(customer.institution)}</span></div>
      <div class="row"><span class="label">Department:</span><span class="value">${escapeHtml(customer.department)}</span></div>
      <div class="row"><span class="label">Course:</span><span class="value">${escapeHtml(customer.course)}</span></div>
      <div class="row"><span class="label">Lecturer:</span><span class="value">${escapeHtml(customer.lecturerName)}</span></div>
      <div class="row"><span class="label">Assignment:</span><span class="value">${escapeHtml(customer.assignmentTitle)}</span></div>
      <div class="footer-note">
        <span>${escapeHtml(note?.trim() || 'Handle with care · Assignment enclosed')}</span>
        <span>${escapeHtml(finishingLabel)}</span>
      </div>
    </div>
  </div>
</body>
</html>`;
}
