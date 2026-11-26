import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadBytes, uploadBytesResumable } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';
import {
  AdminPrivateSettings,
  DEFAULT_CURRENCY,
  DEFAULT_PRICING_CONFIG,
  DEFAULT_PRINTING_SERVICES,
  EmailNotificationMeta,
  normalizeOrderStatus,
  OrderAuditEntry,
  OrderQuotationMeta,
  OrderStatus,
  PaymentStatus,
  PricingConfig,
  PrintingServiceItem,
  PrintOrderRecord,
  StudioSettings,
  WhatsAppNotificationMeta,
} from './types';

export const ADMIN_EMAIL = 'badax1010@gmail.com';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);
storage.maxUploadRetryTime = 8000;
storage.maxOperationRetryTime = 8000;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export function subscribeToAuth(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export async function signInAdminWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

export async function signOutAdmin(): Promise<void> {
  await signOut(auth);
}

export function isAuthorizedAdminUser(user: User | null): boolean {
  if (!user || !user.emailVerified || !user.email) return false;
  return user.email.toLowerCase() === ADMIN_EMAIL;
}

export interface UploadedStorageFileResult {
  filename: string;
  storagePath: string;
  downloadUrl: string;
}

function resolveCanonicalMimeType(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'doc') return 'application/msword';
  if (ext === 'docx') {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return file.type || 'application/octet-stream';
}

function formatFirebaseStorageError(
  err: unknown,
  filename: string,
  bucketName: string,
): Error {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code)
      : '';
  const rawServerResponse =
    err &&
    typeof err === 'object' &&
    'customData' in err &&
    (err as { customData?: { serverResponse?: unknown } }).customData &&
    typeof (err as { customData?: { serverResponse?: unknown } }).customData === 'object'
      ? String((err as { customData?: { serverResponse?: unknown } }).customData?.serverResponse || '')
      : '';
  const detail = err instanceof Error ? err.message : String(err);

  if (code === 'storage/unauthorized') {
    return new Error(
      `Upload permission denied for "${filename}" (${code}). Check Firebase Storage security rules for bucket "${bucketName}".`,
    );
  }
  if (
    code === 'storage/bucket-not-found' ||
    code === 'storage/project-not-found' ||
    (code === 'storage/unknown' &&
      (!rawServerResponse || rawServerResponse.includes('404') || detail.includes('404')))
  ) {
    return new Error(
      `Firebase Storage bucket "${bucketName}" is not provisioned or returned 404 Not Found (${code}). Enable Cloud Storage in Firebase Console for project "${firebaseConfig.projectId}".`,
    );
  }
  if (code === 'storage/retry-limit-exceeded') {
    return new Error(
      `Upload timed out while connecting to Firebase Storage bucket "${bucketName}" (${code}). Verify Cloud Storage is enabled and CORS/network access is permitted.`,
    );
  }
  if (code === 'storage/quota-exceeded') {
    return new Error(`Firebase Storage quota exceeded while uploading "${filename}".`);
  }
  if (code === 'storage/canceled') {
    return new Error(
      `Upload stalled at 0% and was cancelled for "${filename}". Check Firebase Storage bucket "${bucketName}" configuration and network connection.`,
    );
  }
  return new Error(`Firebase Storage upload failed for "${filename}" (${code || 'unknown'}): ${detail}`);
}

export async function uploadFilesToFirebaseStorageWithProgress(
  orderId: string,
  files: File[],
  envelopeHtml?: string,
  onProgress?: (percent: number) => void,
): Promise<{
  uploaded: UploadedStorageFileResult[];
  filePaths: string[];
  labelStoragePath: string;
  labelDownloadUrl: string;
}> {
  if (!files || files.length === 0) {
    throw new Error('No document selected for Firebase Storage upload.');
  }

  const bucketName = firebaseConfig.storageBucket || storage.app.options.storageBucket || '';
  if (!bucketName) {
    throw new Error('Firebase Storage bucket is missing from firebase-applet-config.json.');
  }

  const uploaded: UploadedStorageFileResult[] = [];
  const filePaths: string[] = [];
  let labelStoragePath = '';
  let labelDownloadUrl = '';

  const totalBytes = files.reduce((sum, f) => sum + Math.max(1, f.size), 0);
  let completedBytes = 0;

  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'document';
    const storagePath = `orders/${orderId}/${safeName}`;
    const fileRef = ref(storage, storagePath);
    const contentType = resolveCanonicalMimeType(file);

    try {
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(fileRef, file, { contentType });
        let highestBytes = 0;
        let settled = false;

        // Guard against browser CORS preflight / 404 XHR loops that hang at 0 bytes
        const stallTimer = setTimeout(() => {
          if (!settled && highestBytes === 0) {
            settled = true;
            try {
              task.cancel();
            } catch {
              // Ignore cancel errors
            }
            reject(
              new Error(
                `Firebase Storage upload stalled at 0% for "${file.name}". Bucket "${bucketName}" may not be activated in Firebase Console or CORS blocked the upload.`,
              ),
            );
          }
        }, 9000);

        task.on(
          'state_changed',
          (snapshot) => {
            if (snapshot.bytesTransferred > highestBytes) {
              highestBytes = snapshot.bytesTransferred;
              clearTimeout(stallTimer);
            }
            if (onProgress && totalBytes > 0) {
              const overall = Math.min(
                95,
                Math.round(((completedBytes + snapshot.bytesTransferred) / totalBytes) * 95),
              );
              onProgress(overall);
            }
          },
          (err) => {
            clearTimeout(stallTimer);
            if (settled) return;
            settled = true;
            reject(formatFirebaseStorageError(err, file.name, bucketName));
          },
          () => {
            clearTimeout(stallTimer);
            if (settled) return;
            settled = true;
            resolve();
          },
        );
      });

      // Wait for upload task completion before requesting the download URL
      const downloadUrl = await getDownloadURL(fileRef);
      if (!downloadUrl || !/^https?:\/\//i.test(downloadUrl)) {
        throw new Error(`Firebase Storage did not return a valid download URL for "${file.name}".`);
      }

      completedBytes += file.size;
      filePaths.push(storagePath);
      uploaded.push({
        filename: file.name,
        storagePath,
        downloadUrl,
      });
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes('Firebase Storage') || err.message.includes('Upload permission'))
      ) {
        throw err;
      }
      throw formatFirebaseStorageError(err, file.name, bucketName);
    }
  }

  if (envelopeHtml) {
    try {
      labelStoragePath = `orders/${orderId}/envelope-label.html`;
      const labelRef = ref(storage, labelStoragePath);
      const labelBlob = new Blob([envelopeHtml], { type: 'text/html;charset=utf-8' });
      await uploadBytes(labelRef, labelBlob, { contentType: 'text/html;charset=utf-8' });
      labelDownloadUrl = await getDownloadURL(labelRef);
    } catch (labelErr) {
      console.warn('Non-fatal envelope label Storage upload warning:', labelErr);
    }
  }

  if (onProgress) onProgress(100);
  return { uploaded, filePaths, labelStoragePath, labelDownloadUrl };
}

export function uploadSessionViaBackendWithProgress(
  payload: unknown,
  onProgress?: (percent: number) => void,
): Promise<{
  order: PrintOrderRecord;
  orderViewUrl: string;
}> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload-session', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.timeout = 45000;

    xhr.upload.onprogress = (evt) => {
      if (!onProgress) return;
      if (evt.lengthComputable && evt.total > 0) {
        const pct = Math.min(95, Math.max(1, Math.round((evt.loaded / evt.total) * 95)));
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      const contentType = xhr.getResponseHeader('content-type') || '';
      if (!contentType.includes('application/json')) {
        reject(
          new Error(
            `Backend upload endpoint is unavailable on this host (HTTP ${xhr.status}). Enable Firebase Storage in Firebase Console for bucket "${firebaseConfig.storageBucket}".`,
          ),
        );
        return;
      }
      try {
        const parsed = JSON.parse(xhr.responseText) as {
          order?: PrintOrderRecord;
          orderViewUrl?: string;
          error?: string;
        };
        if (xhr.status < 200 || xhr.status >= 300 || !parsed.order) {
          reject(new Error(parsed.error || `Document upload failed (HTTP ${xhr.status}).`));
          return;
        }
        if (onProgress) onProgress(100);
        resolve({
          order: parsed.order,
          orderViewUrl: parsed.orderViewUrl || '',
        });
      } catch {
        reject(new Error('Invalid JSON response returned from upload service.'));
      }
    };

    xhr.onerror = () => reject(new Error('Network error while uploading document to server.'));
    xhr.ontimeout = () => reject(new Error('Document upload timed out. Please try again.'));
    xhr.send(JSON.stringify(payload));
  });
}

export async function uploadOrderAssetsToFirebaseStorage(
  orderId: string,
  pdfFile: File,
  envelopeHtml: string,
): Promise<{
  pdfStoragePath: string;
  pdfDownloadUrl: string;
  labelStoragePath: string;
  labelDownloadUrl: string;
}> {
  const result = await uploadFilesToFirebaseStorageWithProgress(orderId, [pdfFile], envelopeHtml);
  return {
    pdfStoragePath: result.filePaths[0] || '',
    pdfDownloadUrl: result.uploaded[0]?.downloadUrl || '',
    labelStoragePath: result.labelStoragePath,
    labelDownloadUrl: result.labelDownloadUrl,
  };
}

function sanitizeOrderPayloadForFirestore(order: PrintOrderRecord, isNewOrder = true) {
  const customerObj: Record<string, string> = {
    fullName: (order.customer.fullName || 'Pending via WhatsApp').slice(0, 120),
    studentId: (order.customer.studentId || 'Pending').slice(0, 60),
    institution: (order.customer.institution || 'Pending via WhatsApp').slice(0, 140),
    department: (order.customer.department || 'Pending via WhatsApp').slice(0, 140),
    course: (order.customer.course || 'Pending via WhatsApp').slice(0, 140),
    lecturerName: (order.customer.lecturerName || 'Pending via WhatsApp').slice(0, 120),
    assignmentTitle: (order.customer.assignmentTitle || order.document.filename || 'Uploaded Document').slice(0, 180),
    whatsappPhone: (order.customer.whatsappPhone || 'WhatsApp').slice(0, 40),
  };
  if (order.customer.altPhone) {
    customerObj.altPhone = order.customer.altPhone.slice(0, 40);
  }

  const sanitizedDocuments = Array.isArray(order.documents) && order.documents.length > 0
    ? order.documents.slice(0, 10).map((d) => ({
        fileId: String(d.fileId || 'file_1').slice(0, 60),
        filename: String(d.filename || 'document').slice(0, 180),
        mimeType: String(d.mimeType || 'application/pdf').slice(0, 120),
        extension: (['pdf', 'doc', 'docx'].includes(d.extension) ? d.extension : 'pdf') as 'pdf' | 'doc' | 'docx',
        pages: Math.max(1, Math.min(2000, Math.round(Number(d.pages) || 1))),
        sizeBytes: Math.max(1, Math.min(20971520, Math.round(Number(d.sizeBytes) || 1))),
        storagePath: String(d.storagePath || '').slice(0, 300),
        secureDownloadUrl: String(d.secureDownloadUrl || '').slice(0, 600),
      }))
    : undefined;

  const payload: Record<string, unknown> = {
    orderId: order.orderId,
    clientRequestId: order.clientRequestId,
    submissionMode: order.submissionMode === 'whatsapp_session' ? 'whatsapp_session' : 'web_checkout',
    status: isNewOrder ? 'ORDER RECEIVED' : normalizeOrderStatus(order.status),
    customer: customerObj,
    document: {
      filename: order.document.filename.slice(0, 180),
      pages: Math.max(1, Math.min(2000, Math.round(Number(order.document.pages) || 1))),
      sizeBytes: Math.max(1, Math.min(104857600, Math.round(Number(order.document.sizeBytes) || 1))),
      storagePath: order.document.storagePath.slice(0, 300),
      secureDownloadUrl: order.document.secureDownloadUrl.slice(0, 600),
    },
    printing: {
      printType: order.printing.printType,
      bwPages: Math.max(0, Math.min(2000, Math.round(Number(order.printing.bwPages) || 0))),
      colorPages: Math.max(0, Math.min(2000, Math.round(Number(order.printing.colorPages) || 0))),
      sides: order.printing.sides,
      copies: Math.max(1, Math.min(200, Math.round(Number(order.printing.copies) || 1))),
      paperSize: 'A4',
      finishing: order.printing.finishing,
      envelopeQuantity: Math.max(0, Math.min(200, Math.round(Number(order.printing.envelopeQuantity) || 0))),
      notes: (order.printing.notes || '').slice(0, 400),
    },
    pricing: {
      currency: (order.pricing.currency || DEFAULT_CURRENCY).slice(0, 12),
      bwSheets: Math.max(0, Math.round(Number(order.pricing.bwSheets) || 0)),
      colorSheets: Math.max(0, Math.round(Number(order.pricing.colorSheets) || 0)),
      bwCost: Number(order.pricing.bwCost || 0),
      colorCost: Number(order.pricing.colorCost || 0),
      sidedCost: Number(order.pricing.sidedCost || 0),
      printingCost: Number(order.pricing.printingCost ?? (order.pricing.bwCost + order.pricing.colorCost)),
      envelopeCost: Number(order.pricing.envelopeCost || 0),
      bindingCost: Number(order.pricing.bindingCost || 0),
      packagingCost: Number(order.pricing.packagingCost ?? order.pricing.envelopeCost),
      deliveryFee: Number(order.pricing.deliveryFee || 0),
      additionalServicesCost: Number(order.pricing.additionalServicesCost || 0),
      additionalCharges: isNewOrder ? 0 : Number(order.pricing.additionalCharges || 0),
      total: Number(order.pricing.total || 0),
    },
    payment: {
      method: order.payment.method,
      status: isNewOrder ? 'PENDING' : order.payment.status,
      reference: (order.payment.reference || '').slice(0, 120),
    },
    delivery: {
      method: order.delivery.method,
      location: (order.delivery.location || 'Pending via WhatsApp').slice(0, 160),
      timeWindow: (order.delivery.timeWindow || 'Next Available (Urgent / Class Today)').slice(0, 100),
      instructions: (order.delivery.instructions || '').slice(0, 400),
    },
    envelopeLabel: {
      storagePath: (order.envelopeLabel.storagePath || '').slice(0, 300),
      secureLabelUrl: (order.envelopeLabel.secureLabelUrl || '').slice(0, 600),
      note: (order.envelopeLabel.note || '').slice(0, 240),
    },
    whatsappNotification: {
      status: order.whatsappNotification.status,
      lastError: (order.whatsappNotification.lastError || '').slice(0, 400),
      attempts: order.whatsappNotification.attempts,
    },
    emailNotification: {
      status: order.emailNotification?.status || 'PENDING',
      lastError: (order.emailNotification?.lastError || '').slice(0, 400),
      attempts: order.emailNotification?.attempts || 0,
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (sanitizedDocuments) {
    payload.documents = sanitizedDocuments;
  }
  if (Array.isArray(order.selectedServices)) {
    payload.selectedServices = order.selectedServices.slice(0, 30).map((s) => String(s).slice(0, 60));
  }
  if (order.whatsappSession) {
    payload.whatsappSession = {
      conversationRef: String(order.whatsappSession.conversationRef || '').slice(0, 120),
      senderPhone: String(order.whatsappSession.senderPhone || '').slice(0, 40),
      step: String(order.whatsappSession.step || '').slice(0, 60),
      lastMessageAt: String(order.whatsappSession.lastMessageAt || '').slice(0, 60),
    };
  }
  if (order.quotation) {
    payload.quotation = {
      summary: String(order.quotation.summary || '').slice(0, 600),
      quotedBy: String(order.quotation.quotedBy || '').slice(0, 120),
      quotedAt: String(order.quotation.quotedAt || '').slice(0, 60),
      totalAmount: Math.max(0, Number(order.quotation.totalAmount) || 0),
      currency: String(order.quotation.currency || DEFAULT_CURRENCY).slice(0, 12),
    };
  }

  return payload;
}

export async function saveOrderToFirestore(order: PrintOrderRecord): Promise<void> {
  const path = `orders/${order.orderId}`;
  try {
    await setDoc(doc(db, 'orders', order.orderId), sanitizeOrderPayloadForFirestore(order, true));
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function syncBotOrderToFirestore(order: PrintOrderRecord): Promise<void> {
  const path = `orders/${order.orderId}`;
  try {
    const refDoc = doc(db, 'orders', order.orderId);
    const snap = await getDoc(refDoc);
    if (!snap.exists()) {
      await setDoc(refDoc, sanitizeOrderPayloadForFirestore(order, false));
      return;
    }
    const sanitized = sanitizeOrderPayloadForFirestore(order, false);
    await updateDoc(refDoc, {
      status: sanitized.status,
      payment: sanitized.payment,
      pricing: sanitized.pricing,
      customer: sanitized.customer,
      printing: sanitized.printing,
      delivery: sanitized.delivery,
      ...(sanitized.selectedServices ? { selectedServices: sanitized.selectedServices } : {}),
      ...(sanitized.quotation ? { quotation: sanitized.quotation } : {}),
      ...(sanitized.whatsappSession ? { whatsappSession: sanitized.whatsappSession } : {}),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    console.warn(`Could not sync bot order ${order.orderId} to Firestore:`, error);
  }
}

export const DEFAULT_STUDIO_SETTINGS: StudioSettings = {
  currency: DEFAULT_CURRENCY,
  orangeMoneyDetails: 'Merchant payment details configurable by administrator in Admin Settings.',
  afriMoneyDetails: 'Africell Money payment details configurable by administrator in Admin Settings.',
};

export async function fetchStudioSettings(): Promise<StudioSettings> {
  try {
    const snap = await getDoc(doc(db, 'settings', 'studio'));
    if (!snap.exists()) {
      return DEFAULT_STUDIO_SETTINGS;
    }
    const data = snap.data() as Partial<StudioSettings>;
    return {
      currency: data.currency || DEFAULT_CURRENCY,
      orangeMoneyDetails: data.orangeMoneyDetails || DEFAULT_STUDIO_SETTINGS.orangeMoneyDetails,
      afriMoneyDetails: data.afriMoneyDetails || DEFAULT_STUDIO_SETTINGS.afriMoneyDetails,
    };
  } catch (error) {
    console.warn('Falling back to default studio settings:', error);
    return DEFAULT_STUDIO_SETTINGS;
  }
}

export async function saveStudioSettingsInFirestore(
  settings: Omit<StudioSettings, 'updatedAt'>,
): Promise<void> {
  const path = 'settings/studio';
  try {
    await setDoc(doc(db, 'settings', 'studio'), {
      currency: settings.currency.trim().slice(0, 12) || DEFAULT_CURRENCY,
      orangeMoneyDetails: settings.orangeMoneyDetails.trim().slice(0, 300),
      afriMoneyDetails: settings.afriMoneyDetails.trim().slice(0, 300),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchPricingConfig(): Promise<PricingConfig> {
  try {
    const snap = await getDoc(doc(db, 'settings', 'pricing'));
    if (!snap.exists()) {
      const srvRes = await fetch('/api/settings/public').catch(() => null);
      if (srvRes && srvRes.ok && srvRes.headers.get('content-type')?.includes('application/json')) {
        const srvJson = (await srvRes.json()) as { pricingConfig?: PricingConfig };
        if (srvJson.pricingConfig) {
          return { ...DEFAULT_PRICING_CONFIG, ...srvJson.pricingConfig };
        }
      }
      return DEFAULT_PRICING_CONFIG;
    }
    const data = snap.data() as Partial<PricingConfig>;
    return {
      currency: data.currency || DEFAULT_PRICING_CONFIG.currency,
      bwPagePrice: Number(data.bwPagePrice ?? DEFAULT_PRICING_CONFIG.bwPagePrice),
      colorPagePrice: Number(data.colorPagePrice ?? DEFAULT_PRICING_CONFIG.colorPagePrice),
      singleSidedPrice: Number(data.singleSidedPrice ?? DEFAULT_PRICING_CONFIG.singleSidedPrice),
      doubleSidedPrice: Number(data.doubleSidedPrice ?? DEFAULT_PRICING_CONFIG.doubleSidedPrice),
      brownEnvelopePrice: Number(data.brownEnvelopePrice ?? DEFAULT_PRICING_CONFIG.brownEnvelopePrice),
      bindingPrice: Number(data.bindingPrice ?? DEFAULT_PRICING_CONFIG.bindingPrice),
      deliveryFee: Number(data.deliveryFee ?? DEFAULT_PRICING_CONFIG.deliveryFee),
      additionalServiceCharge: Number(
        data.additionalServiceCharge ?? DEFAULT_PRICING_CONFIG.additionalServiceCharge,
      ),
    };
  } catch (error) {
    console.warn('Falling back to default pricing config:', error);
    return DEFAULT_PRICING_CONFIG;
  }
}

export async function savePricingConfigInFirestore(
  config: Omit<PricingConfig, 'updatedAt'>,
): Promise<void> {
  const path = 'settings/pricing';
  try {
    await setDoc(doc(db, 'settings', 'pricing'), {
      currency: (config.currency || DEFAULT_CURRENCY).trim().slice(0, 12),
      bwPagePrice: Math.max(0, Number(config.bwPagePrice) || 0),
      colorPagePrice: Math.max(0, Number(config.colorPagePrice) || 0),
      singleSidedPrice: Math.max(0, Number(config.singleSidedPrice) || 0),
      doubleSidedPrice: Math.max(0, Number(config.doubleSidedPrice) || 0),
      brownEnvelopePrice: Math.max(0, Number(config.brownEnvelopePrice) || 0),
      bindingPrice: Math.max(0, Number(config.bindingPrice) || 0),
      deliveryFee: Math.max(0, Number(config.deliveryFee) || 0),
      additionalServiceCharge: Math.max(0, Number(config.additionalServiceCharge) || 0),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchServicesCatalog(): Promise<PrintingServiceItem[]> {
  try {
    const snap = await getDoc(doc(db, 'settings', 'services'));
    if (!snap.exists()) {
      const srvRes = await fetch('/api/settings/public').catch(() => null);
      if (srvRes && srvRes.ok && srvRes.headers.get('content-type')?.includes('application/json')) {
        const srvJson = (await srvRes.json()) as { services?: PrintingServiceItem[] };
        if (Array.isArray(srvJson.services) && srvJson.services.length > 0) {
          return srvJson.services;
        }
      }
      return DEFAULT_PRINTING_SERVICES;
    }
    const data = snap.data() as { services?: PrintingServiceItem[] };
    if (Array.isArray(data.services) && data.services.length > 0) {
      return data.services;
    }
    return DEFAULT_PRINTING_SERVICES;
  } catch (error) {
    console.warn('Falling back to default printing services:', error);
    return DEFAULT_PRINTING_SERVICES;
  }
}

export async function saveServicesCatalogInFirestore(
  services: PrintingServiceItem[],
): Promise<void> {
  const path = 'settings/services';
  try {
    await setDoc(doc(db, 'settings', 'services'), {
      services: services.slice(0, 40).map((svc) => ({
        id: String(svc.id).slice(0, 60),
        name: String(svc.name).slice(0, 120),
        category: svc.category,
        description: String(svc.description || '').slice(0, 300),
        price: Math.max(0, Number(svc.price) || 0),
        unitLabel: String(svc.unitLabel || '').slice(0, 80),
        enabled: Boolean(svc.enabled),
      })),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchAdminPrivateSettings(): Promise<AdminPrivateSettings> {
  const path = 'adminSettings/whatsapp';
  try {
    const snap = await getDoc(doc(db, 'adminSettings', 'whatsapp'));
    if (!snap.exists()) {
      return {
        adminWhatsappNumbers: [],
        whatsappTemplateName: '',
        whatsappTemplateLanguage: 'en_US',
        adminNotificationEmail: ADMIN_EMAIL,
      };
    }
    const data = snap.data() as Partial<AdminPrivateSettings>;
    return {
      adminWhatsappNumbers: Array.isArray(data.adminWhatsappNumbers)
        ? data.adminWhatsappNumbers
        : [],
      whatsappTemplateName: data.whatsappTemplateName || '',
      whatsappTemplateLanguage: data.whatsappTemplateLanguage || 'en_US',
      adminNotificationEmail: data.adminNotificationEmail || ADMIN_EMAIL,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveAdminPrivateSettingsInFirestore(
  settings: Omit<AdminPrivateSettings, 'updatedAt'>,
): Promise<void> {
  const path = 'adminSettings/whatsapp';
  try {
    await setDoc(doc(db, 'adminSettings', 'whatsapp'), {
      adminWhatsappNumbers: settings.adminWhatsappNumbers.slice(0, 5),
      whatsappTemplateName: settings.whatsappTemplateName.trim().slice(0, 120),
      whatsappTemplateLanguage: settings.whatsappTemplateLanguage.trim().slice(0, 20) || 'en_US',
      adminNotificationEmail: (settings.adminNotificationEmail || ADMIN_EMAIL).trim().slice(0, 160),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

function normalizeFirestoreTimestamp(val: unknown): string {
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

export function subscribeToOrders(
  onData: (orders: PrintOrderRecord[]) => void,
  onError: (err: Error) => void,
) {
  const path = 'orders';
  const q = query(collection(db, path), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: PrintOrderRecord[] = snapshot.docs.map((d) => {
        const raw = d.data() as Record<string, unknown>;
        const rec = raw as unknown as PrintOrderRecord;
        return {
          ...rec,
          orderId: d.id,
          status: normalizeOrderStatus(rec.status),
          createdAt: normalizeFirestoreTimestamp(raw.createdAt),
          updatedAt: normalizeFirestoreTimestamp(raw.updatedAt),
        };
      });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToOrderAudit(
  orderId: string,
  onData: (entries: OrderAuditEntry[]) => void,
) {
  const path = `orders/${orderId}/audit`;
  const q = query(collection(db, 'orders', orderId, 'audit'), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: OrderAuditEntry[] = snapshot.docs.map((d) => {
        const raw = d.data() as Record<string, unknown>;
        return {
          ...(raw as unknown as OrderAuditEntry),
          id: d.id,
          createdAt: normalizeFirestoreTimestamp(raw.createdAt),
        };
      });
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    },
  );
}

export async function addOrderAuditEntry(
  entry: Omit<OrderAuditEntry, 'id' | 'createdAt'>,
): Promise<void> {
  const path = `orders/${entry.orderId}/audit`;
  try {
    await addDoc(collection(db, 'orders', entry.orderId, 'audit'), {
      orderId: entry.orderId,
      action: entry.action.slice(0, 80),
      actorEmail: entry.actorEmail.slice(0, 160),
      previousValue: entry.previousValue.slice(0, 200),
      newValue: entry.newValue.slice(0, 200),
      note: entry.note.slice(0, 400),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateOrderStatusInFirestore(
  order: PrintOrderRecord,
  nextStatus: OrderStatus,
  actorEmail: string,
): Promise<void> {
  const path = `orders/${order.orderId}`;
  try {
    await updateDoc(doc(db, 'orders', order.orderId), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
    await addOrderAuditEntry({
      orderId: order.orderId,
      action: 'STATUS_UPDATED',
      actorEmail,
      previousValue: order.status,
      newValue: nextStatus,
      note: `Order status changed from ${order.status} to ${nextStatus}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateOrderPaymentStatusInFirestore(
  order: PrintOrderRecord,
  nextPaymentStatus: PaymentStatus,
  actorEmail: string,
  note = '',
): Promise<void> {
  const path = `orders/${order.orderId}`;
  try {
    await updateDoc(doc(db, 'orders', order.orderId), {
      payment: {
        ...order.payment,
        status: nextPaymentStatus,
      },
      updatedAt: serverTimestamp(),
    });
    await addOrderAuditEntry({
      orderId: order.orderId,
      action: 'PAYMENT_VERIFICATION',
      actorEmail,
      previousValue: order.payment.status,
      newValue: nextPaymentStatus,
      note: note || `Payment marked ${nextPaymentStatus} (${order.payment.method})`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateOrderQuotationInFirestore(
  order: PrintOrderRecord,
  quotation: OrderQuotationMeta,
  additionalCharges: number,
  nextTotal: number,
  actorEmail: string,
): Promise<void> {
  const path = `orders/${order.orderId}`;
  try {
    await updateDoc(doc(db, 'orders', order.orderId), {
      pricing: {
        ...order.pricing,
        additionalCharges: Math.max(0, Number(additionalCharges) || 0),
        total: Math.max(0, Number(nextTotal) || 0),
      },
      quotation,
      updatedAt: serverTimestamp(),
    });
    await addOrderAuditEntry({
      orderId: order.orderId,
      action: 'QUOTATION_UPDATED',
      actorEmail,
      previousValue: `${order.pricing.currency} ${order.pricing.total}`,
      newValue: `${quotation.currency} ${quotation.totalAmount}`,
      note: quotation.summary.slice(0, 400),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateOrderAdditionalChargesInFirestore(
  order: PrintOrderRecord,
  additionalCharges: number,
  actorEmail: string,
  note: string,
): Promise<void> {
  const path = `orders/${order.orderId}`;
  const safeExtra = Math.max(0, Number(additionalCharges) || 0);
  const baseSubtotal =
    (order.pricing.printingCost ?? (order.pricing.bwCost + order.pricing.colorCost)) +
    (order.pricing.packagingCost ?? order.pricing.envelopeCost) +
    (order.pricing.deliveryFee ?? 0) +
    (order.pricing.additionalServicesCost ?? 0);
  const nextTotal = Number((baseSubtotal + safeExtra).toFixed(2));
  try {
    await updateDoc(doc(db, 'orders', order.orderId), {
      pricing: {
        ...order.pricing,
        additionalCharges: safeExtra,
        total: nextTotal,
      },
      updatedAt: serverTimestamp(),
    });
    await addOrderAuditEntry({
      orderId: order.orderId,
      action: 'ADDITIONAL_CHARGES_UPDATED',
      actorEmail,
      previousValue: `${order.pricing.currency} ${order.pricing.additionalCharges}`,
      newValue: `${order.pricing.currency} ${safeExtra}`,
      note: note || 'Approved additional charges updated by administrator',
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateOrderWhatsappNotificationInFirestore(
  orderId: string,
  nextNotification: WhatsAppNotificationMeta,
  actorEmail: string,
): Promise<void> {
  const path = `orders/${orderId}`;
  try {
    await updateDoc(doc(db, 'orders', orderId), {
      whatsappNotification: nextNotification,
      updatedAt: serverTimestamp(),
    });
    await addOrderAuditEntry({
      orderId,
      action: 'WHATSAPP_NOTIFICATION_RETRY',
      actorEmail,
      previousValue: 'FAILED',
      newValue: nextNotification.status,
      note: nextNotification.lastError || 'Notification dispatched successfully',
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateOrderEmailNotificationInFirestore(
  orderId: string,
  nextNotification: EmailNotificationMeta,
  actorEmail: string,
): Promise<void> {
  const path = `orders/${orderId}`;
  try {
    await updateDoc(doc(db, 'orders', orderId), {
      emailNotification: nextNotification,
      updatedAt: serverTimestamp(),
    });
    await addOrderAuditEntry({
      orderId,
      action: 'EMAIL_NOTIFICATION_RETRY',
      actorEmail,
      previousValue: 'FAILED',
      newValue: nextNotification.status,
      note: nextNotification.lastError || 'Order email with attachments sent successfully',
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
