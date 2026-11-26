# Security Summary

**Reviewed Files**: 14 (`server.ts`, `src/App.tsx`, `src/firebase.ts`, `src/envelopeHtml.ts`, `src/components/*`, `firestore.rules`, `storage.rules`, `firebase-applet-config.json`, `.env.example`, `package.json`)
**Issues Resolved**: 4

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Signing Secret Written to Disk | `server.ts` | 90–107 | When `DOWNLOAD_SIGNING_SECRET` was unset, the server generated a signing key and saved it to `uploads/.signing_key` on disk. | Medium | Fixed | Removed disk file persistence and switched to an in-memory `crypto.randomBytes(32)` fallback when `DOWNLOAD_SIGNING_SECRET` is not configured; deleted `uploads/.signing_key`. |
| Unverified Webhook Acceptance | `server.ts` | 1909–1926 | `POST /api/whatsapp/webhook` skipped HMAC signature verification whenever `WHATSAPP_APP_SECRET` was unset. | High | Fixed | Updated `POST /api/whatsapp/webhook` to fail closed (`503`) unless `WHATSAPP_APP_SECRET` is set and always verify `X-Hub-Signature-256`; updated `GET /api/whatsapp/webhook` to use `crypto.timingSafeEqual`. |
| Business Number in Client JS | `src/components/AdminDashboard.tsx` | 1243, 1342 | The business WhatsApp number appeared as literal UI text and input placeholder in the compiled client bundle. | Low | Fixed | Replaced the literal number with generic format text (`+232 country code` / `232XXXXXXXX`) so the number is kept server-side and fetched only by signed-in Admin. |
| Storage Upload Access | `storage.rules` | 10–21 | Firebase Storage allowed unauthenticated writes to `/orders/{orderId}/{fileName}` from earlier web upload forms. | Medium | Fixed | Restricted both reads and writes under `/orders/{orderId}/{fileName}` to verified administrator `badax1010@gmail.com`. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| Private API Keys & Secrets | `.env.example`, `server.ts` | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `BOT_API_SECRET`, `SMTP_PASS`, and `RESEND_API_KEY` are read solely from server-side `process.env` and never bundled into `src/`. |
| Firebase Client Config | `firebase-applet-config.json`, `firestore.rules` | Only standard public Firebase web client identifiers reside in client config; data access is governed by strict verified-admin rules in `firestore.rules`. |
| Administrator & Bot Endpoints | `server.ts` | `/api/admin/*` verifies Firebase ID tokens (`badax1010@gmail.com`, `emailVerified: true`) against Identity Toolkit, and `/api/bot/*` verifies `BOT_API_SECRET` using constant-time comparison (`crypto.timingSafeEqual`) or an admin Firebase token. |
| File Path & Header Safety | `server.ts` | File paths are normalized via `path.resolve` with `uploads/<orderId>/` prefix containment checks; download responses sanitize filenames and send `X-Content-Type-Options: nosniff`. |
| HTML & Email Rendering | `src/envelopeHtml.ts`, `server.ts` | Envelope labels and admin emails HTML-escape all user fields (`escapeHtml`, `escapeHtmlEmail`), and React components render text without raw HTML injection. |

---

## PoC Verification

### Unauthenticated / Unsigned WhatsApp Webhook Rejection

#### Summary
| Field | Value |
|---|---|
| Issue Type | Fail-open webhook signature verification |
| Impact | High |
| Affected File | `server.ts:1906-1925` |
| Test Scenario | Sending an unsigned `POST /api/whatsapp/webhook` payload referencing an order ID when `WHATSAPP_APP_SECRET` is unset or mismatched. |

#### How It Was Fixed
Added a fail-closed guard at the start of `POST /api/whatsapp/webhook` returning `503` whenever `WHATSAPP_APP_SECRET` is missing, and requiring a valid `X-Hub-Signature-256` HMAC-SHA256 header checked with `crypto.timingSafeEqual` on every request.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Unsigned JSON request arrives at `POST /api/whatsapp/webhook` (`server.ts:1906`) | Enters webhook handler |
| 2 | Handler checks `process.env.WHATSAPP_APP_SECRET?.trim()` (`server.ts:1907-1909`) | Returns `503` if unconfigured |
| 3 | If secret is configured, checks `X-Hub-Signature-256` via `crypto.timingSafeEqual` (`server.ts:1910-1924`) | Rejects missing/forged signatures with `401` |

#### Conclusion
**Fix Verified** - Forged or unsigned webhook requests cannot reach `handleConversationalWhatsappMessage` or mutate order state.

### Ephemeral Signing Secret & Download Header Hardening

#### Summary
| Field | Value |
|---|---|
| Issue Type | On-disk secret persistence and unhardened file download headers |
| Impact | Medium |
| Affected File | `server.ts:90-95, 1994-1997, 2132-2137, 2257-2260` |
| Test Scenario | Server startup without `DOWNLOAD_SIGNING_SECRET`, followed by requesting a file download endpoint. |

#### How It Was Fixed
Removed file-system writes (`SIGNING_KEY_PATH` / `uploads/.signing_key`) so missing `DOWNLOAD_SIGNING_SECRET` falls back to an in-memory 32-byte random hex key, deleted `uploads/.signing_key`, sanitized download filenames, and added `X-Content-Type-Options: nosniff`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `getSigningSecret()` executes at startup (`server.ts:90-95`) | Reads `process.env.DOWNLOAD_SIGNING_SECRET` or returns in-memory random bytes (no file written) |
| 2 | Authorized request hits `/api/secure/document/:orderId` or `/api/admin/orders/:orderId/document` | Verifies HMAC token or Admin Bearer token |
| 3 | Response sets sanitized filename + `X-Content-Type-Options: nosniff` | **Handled Safely** |

#### Conclusion
**Fix Verified** - Signing secrets are no longer written to disk and file downloads are protected against header injection and MIME sniffing.
