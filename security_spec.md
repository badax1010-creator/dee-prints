# DEE PRINTS Firestore Security Specification

## 1. Data Invariants
1. Students may submit new orders at `/orders/{orderId}` only with `status == 'ORDER RECEIVED'`, `payment.status == 'PENDING'`, `pricing.additionalCharges == 0`, valid positive quantities, valid payment method (`orange_money`, `afri_money`, or `payment_on_delivery`), and server-assigned timestamps (`createdAt == request.time`, `updatedAt == request.time`).
2. Student orders contain PII (`customer.whatsappPhone`, `customer.fullName`, `customer.studentId`) and private document paths (`document.storagePath`); only verified administrators (`badax1010@gmail.com` with `email_verified == true` or registered in `/admins/{uid}`) may `get`, `list`, `update`, or `delete` orders.
3. Audit trail entries at `/orders/{orderId}/audit/{auditId}` require the parent order to exist, are append-only by verified administrators, and cannot be updated or deleted.
4. Storefront settings at `/settings/studio` expose only non-secret currency and official payment instructions; private administrator WhatsApp numbers live in `/adminSettings/{settingId}` and are strictly admin-only.
5. Admin directory `/admins/{uid}` is readable and writable only by verified administrators (preventing self-escalation).

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated `get` or `list` on `/orders` (PII scraping attempt).
2. Non-admin authenticated user `get` or `list` on `/orders`.
3. Student `create` on `/orders/{orderId}` with `status: "COMPLETED"` (state shortcutting).
4. Student `create` on `/orders/{orderId}` with `payment.status: "CONFIRMED"` (auto-confirming electronic payment).
5. Student `create` on `/orders/{orderId}` with `payment.method: "q_money"` (disallowed payment method).
6. Student `create` on `/orders/{orderId}` with an extra ghost field `isVerified: true` (shadow field injection).
7. Student `create` on `/orders/{orderId}` with forged client `createdAt` timestamp instead of `request.time`.
8. Student `create` on `/orders/{orderId}` with malformed `orderId` containing path/junk characters (>40 chars).
9. Unauthenticated or non-admin `update` on `/orders/{orderId}` trying to change `status` or `payment.status`.
10. Unverified email spoof (`email: "badax1010@gmail.com"`, `email_verified: false`) attempting admin read/write.
11. Any user attempting `create` on `/admins/{uid}` to escalate privileges.
12. Unauthenticated or non-admin `read` or `write` on `/adminSettings/whatsapp` (exposing admin WhatsApp numbers).
