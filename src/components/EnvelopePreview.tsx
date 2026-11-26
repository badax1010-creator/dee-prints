import React from 'react';
import { CustomerDetails } from '../types';

interface EnvelopePreviewProps {
  customer: CustomerDetails;
  envelopeQuantity: number;
  copies: number;
  finishingLabel: string;
  envelopeNote?: string;
  orderId?: string;
}

export const EnvelopePreview: React.FC<EnvelopePreviewProps> = ({
  customer,
  envelopeQuantity,
  copies,
  finishingLabel,
  envelopeNote,
  orderId,
}) => {
  if (envelopeQuantity <= 0) {
    return (
      <div className="rounded-xl border border-[#E5E3DE] bg-[#F3F1EC] p-5 text-sm text-[#57544E]">
        <p className="font-medium text-[#141413]">No Brown Envelope Selected (0 Envelopes)</p>
        <p className="mt-1">
          Your {copies} {copies === 1 ? 'copy' : 'copies'} ({finishingLabel}) will be prepared without an A4 brown kraft envelope. Increase Brown Envelope Quantity above to include a personalized envelope.
        </p>
      </div>
    );
  }

  return (
    <div className="relative rounded-xl border border-[#CBBBA0] bg-[#DFC9A6] p-5 shadow-sm text-[#141413] overflow-hidden">
      {/* Top envelope flap fold line */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-8 border-b border-[#BFA883]/80 bg-[#D6BC94]"
        style={{ clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }}
      />

      <div className="relative pt-5">
        <div className="flex items-center justify-between text-[11px] font-mono text-[#5B4B34] mb-3 tabular-nums">
          <span>BROWN ENVELOPE PERSONALIZATION</span>
          <span>
            {orderId ? `${orderId} · ` : ''}
            {envelopeQuantity} {envelopeQuantity === 1 ? 'ENVELOPE' : 'ENVELOPES'}
          </span>
        </div>

        {/* Printed white label */}
        <div className="rounded-lg bg-white border border-[#E5E3DE] p-4 shadow-xs">
          <div className="flex items-start justify-between gap-3 border-b-2 border-[#141413] pb-2.5 mb-3">
            <div>
              <p className="font-display text-base font-bold tracking-tight text-[#141413]">
                DEE PRINTS
              </p>
              <p className="font-mono text-[11px] text-[#6B6760] tabular-nums">
                {orderId ? `Order Ref: ${orderId}` : 'Auto-Generated Envelope Label'}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[11px] font-mono text-[#6B6760]">COPIES</p>
              <p className="font-mono text-sm font-semibold text-[#141413] tabular-nums">
                {copies}x
              </p>
            </div>
          </div>

          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-[#6B6760] shrink-0">Student Name</dt>
              <dd className="text-right font-semibold text-[#141413] truncate">
                {customer.fullName.trim() || 'Student Full Name'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#6B6760] shrink-0">Student ID</dt>
              <dd className="text-right font-mono font-semibold text-[#141413] tabular-nums truncate">
                {customer.studentId.trim() || 'LKW-XXXX-XXXX'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#6B6760] shrink-0">Institution</dt>
              <dd className="text-right font-medium text-[#141413] truncate">
                {customer.institution.trim() || 'College / University'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#6B6760] shrink-0">Department</dt>
              <dd className="text-right text-[#141413] truncate">
                {customer.department.trim() || 'Department / Faculty'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#6B6760] shrink-0">Course</dt>
              <dd className="text-right font-medium text-[#141413] truncate">
                {customer.course.trim() || 'Course or Subject'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#6B6760] shrink-0">Lecturer</dt>
              <dd className="text-right text-[#141413] truncate">
                {customer.lecturerName.trim() || 'Lecturer Name'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#6B6760] shrink-0">Assignment</dt>
              <dd className="text-right font-medium text-[#141413] truncate">
                {customer.assignmentTitle.trim() || 'Assignment Title'}
              </dd>
            </div>
          </dl>

          <div className="mt-3 pt-2.5 border-t border-dashed border-[#DFDDD6] flex items-center justify-between gap-2 text-[11px]">
            <span className="font-medium text-[#141413] truncate">
              {envelopeNote?.trim() || 'Handle with care · Assignment enclosed'}
            </span>
            <span className="font-mono text-[#6B6760] shrink-0">{finishingLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
