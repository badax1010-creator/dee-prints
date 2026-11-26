import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  MessageSquare,
  Minus,
  Plus,
  Send,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { buildEnvelopeLabelHtml } from '../envelopeHtml';
import {
  DEFAULT_STUDIO_SETTINGS,
  fetchPricingConfig,
  fetchServicesCatalog,
  fetchStudioSettings,
  saveOrderToFirestore,
  uploadFilesToFirebaseStorageWithProgress,
} from '../firebase';
import {
  calculateDynamicOrderPrice,
  CAMPUS_DROP_ZONES,
  CustomerDetails,
  DEFAULT_INSTITUTIONS,
  DEFAULT_PRICING_CONFIG,
  DEFAULT_PRINTING_SERVICES,
  DELIVERY_TIME_WINDOWS,
  DeliveryDetails,
  FINISHING_OPTIONS,
  FinishingType,
  LIMKOKWING_DEPARTMENTS,
  PAYMENT_OPTIONS,
  PaymentMethod,
  PricingConfig,
  PrintingPreferences,
  PrintingServiceItem,
  PrintOrderRecord,
  PrintSides,
  PrintType,
  StudioSettings,
  SubmitOrderPayload,
  UploadedDocumentItem,
  UploadSessionPayload,
} from '../types';
import { buildWhatsappOrderUrl, generateOrderReference } from '../whatsapp';
import { EnvelopePreview } from './EnvelopePreview';

interface PrintStudioProps {
  onOpenOrderSheet: (orderId: string, signedSearch?: string) => void;
  onOpenTrack?: (orderId: string) => void;
}

interface LocalSelectedFile {
  localId: string;
  file: File;
  base64: string;
  extension: 'pdf' | 'doc' | 'docx';
  mimeType: string;
  pages: number;
  previewUrl: string | null;
}

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 10;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function trySyncBackendJson<T>(url: string, payload: unknown): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function cacheOrderForSession(order: PrintOrderRecord): void {
  try {
    sessionStorage.setItem(`dee_order_${order.orderId}`, JSON.stringify(order));
  } catch {
    // Ignore storage quota errors
  }
}

export const PrintStudio: React.FC<PrintStudioProps> = ({
  onOpenOrderSheet,
  onOpenTrack,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [studioSettings, setStudioSettings] = useState<StudioSettings>(DEFAULT_STUDIO_SETTINGS);
  const [pricingConfig, setPricingConfig] = useState<PricingConfig>(DEFAULT_PRICING_CONFIG);
  const [servicesCatalog, setServicesCatalog] = useState<PrintingServiceItem[]>(DEFAULT_PRINTING_SERVICES);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(['bw_printing', 'assignment_printing', 'brown_envelope']);
  const [isDragging, setIsDragging] = useState(false);

  // Uploaded files state (PDF, DOC, DOCX)
  const [uploadedFiles, setUploadedFiles] = useState<LocalSelectedFile[]>([]);
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
  const [parsingFiles, setParsingFiles] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);

  // Customer & academic details (auto-connected to Brown Envelope Label)
  const [institutionChoice, setInstitutionChoice] = useState<string>(DEFAULT_INSTITUTIONS[0]);
  const [customInstitution, setCustomInstitution] = useState('');
  const [customer, setCustomer] = useState<CustomerDetails>({
    fullName: '',
    studentId: '',
    institution: DEFAULT_INSTITUTIONS[0],
    department: LIMKOKWING_DEPARTMENTS[0],
    course: '',
    lecturerName: '',
    assignmentTitle: '',
    whatsappPhone: '',
    altPhone: '',
  });

  // Printing preferences
  const [printing, setPrinting] = useState<PrintingPreferences>({
    printType: 'bw',
    bwPages: 1,
    colorPages: 0,
    sides: 'single',
    copies: 1,
    paperSize: 'A4',
    finishing: 'none',
    envelopeQuantity: 1,
    notes: '',
  });

  const [envelopeNote, setEnvelopeNote] = useState('');

  // Delivery preferences
  const [delivery, setDelivery] = useState<DeliveryDetails>({
    method: 'campus_delivery',
    location: CAMPUS_DROP_ZONES[1],
    timeWindow: DELIVERY_TIME_WINDOWS[0],
    instructions: '',
  });
  const [customOffCampusAddress, setCustomOffCampusAddress] = useState('');

  // Payment option
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod | null>(null);
  const [paymentReference, setPaymentReference] = useState('');

  // Submission & confirmation state
  const [clientRequestId, setClientRequestId] = useState<string>(() => newRequestId());
  const [submitting, setSubmitting] = useState(false);
  const [startingWhatsapp, setStartingWhatsapp] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [whatsappSessionReady, setWhatsappSessionReady] = useState<{
    order: PrintOrderRecord;
    whatsappContinueUrl: string;
    orderViewSearch: string;
  } | null>(null);
  const [confirmation, setConfirmation] = useState<{
    order: PrintOrderRecord;
    orderViewSearch: string;
    whatsappContinueUrl: string;
    firestoreSaved: boolean;
  } | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchStudioSettings(),
      fetchPricingConfig(),
      fetchServicesCatalog(),
    ]).then(([studio, pricingCfg, services]) => {
      if (!active) return;
      setStudioSettings(studio);
      setPricingConfig(pricingCfg);
      setServicesCatalog(services);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      uploadedFiles.forEach((f) => {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      });
    };
  }, []);

  const activeCurrency = pricingConfig.currency || studioSettings.currency;

  const totalDetectedPages = useMemo(() => {
    if (uploadedFiles.length === 0) return 0;
    return uploadedFiles.reduce((sum, f) => sum + Math.max(1, f.pages), 0);
  }, [uploadedFiles]);

  const effectivePageCount = totalDetectedPages > 0 ? totalDetectedPages : 1;

  const effectiveInstitution =
    institutionChoice === 'Other College / University'
      ? customInstitution.trim()
      : institutionChoice;

  const customerForPreview: CustomerDetails = useMemo(
    () => ({
      ...customer,
      institution: effectiveInstitution || customer.institution,
    }),
    [customer, effectiveInstitution],
  );

  const selectedFinishingMeta = useMemo(
    () => FINISHING_OPTIONS.find((f) => f.id === printing.finishing) || FINISHING_OPTIONS[0],
    [printing.finishing],
  );

  const livePricing = useMemo(
    () =>
      calculateDynamicOrderPrice({
        pages: effectivePageCount,
        printType: printing.printType,
        bwPages: printing.bwPages,
        colorPages: printing.colorPages,
        sides: printing.sides,
        copies: printing.copies,
        envelopeQuantity: printing.envelopeQuantity,
        finishing: printing.finishing,
        deliveryMethod: delivery.method,
        selectedServiceIds,
        servicesCatalog,
        pricingConfig,
        additionalCharges: 0,
        currency: activeCurrency,
      }),
    [
      effectivePageCount,
      printing.printType,
      printing.bwPages,
      printing.colorPages,
      printing.sides,
      printing.copies,
      printing.envelopeQuantity,
      printing.finishing,
      delivery.method,
      selectedServiceIds,
      servicesCatalog,
      pricingConfig,
      activeCurrency,
    ],
  );

  const toggleServiceSelection = (serviceId: string) => {
    setSelectedServiceIds((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId],
    );
  };

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setFileError(null);
    setSubmitError(null);
    setConfirmation(null);
    setWhatsappSessionReady(null);
    setUploadProgress(0);

    const incoming = Array.from(fileList);
    if (uploadedFiles.length + incoming.length > MAX_FILES) {
      setFileError(`You can upload up to ${MAX_FILES} documents per order.`);
      return;
    }

    setParsingFiles(true);
    const parsedBatch: LocalSelectedFile[] = [];

    try {
      for (const file of incoming) {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const isPdf = ext === 'pdf' || file.type === 'application/pdf';
        const isDoc = ext === 'doc' || file.type === 'application/msword';
        const isDocx =
          ext === 'docx' ||
          file.type ===
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

        if (!isPdf && !isDoc && !isDocx) {
          throw new Error(
            `"${file.name}" is not supported. Upload PDF, DOC, or DOCX documents.`,
          );
        }
        if (file.size === 0 || file.size > MAX_FILE_BYTES) {
          throw new Error(`"${file.name}" is empty or exceeds the 20 MB limit.`);
        }

        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let pages = 1;
        let extension: 'pdf' | 'doc' | 'docx' = 'pdf';
        let mimeType = 'application/pdf';
        let previewUrl: string | null = null;

        if (isPdf) {
          const header = new TextDecoder().decode(bytes.slice(0, 5));
          if (header !== '%PDF-') {
            throw new Error(`"${file.name}" is not a valid PDF file.`);
          }
          const pdfDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
          pages = pdfDoc.getPageCount();
          if (pages < 1 || pages > 2000) {
            throw new Error(`"${file.name}" page count must be between 1 and 2000.`);
          }
          previewUrl = URL.createObjectURL(file);
        } else if (isDoc) {
          extension = 'doc';
          mimeType = 'application/msword';
        } else {
          if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
            throw new Error(`"${file.name}" does not appear to be a valid DOCX document.`);
          }
          extension = 'docx';
          mimeType =
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        }

        const base64 = await readFileAsDataUrl(file);
        parsedBatch.push({
          localId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          file,
          base64,
          extension,
          mimeType,
          pages,
          previewUrl,
        });
      }

      const nextList = [...uploadedFiles, ...parsedBatch];
      const nextTotalPages = nextList.reduce((sum, f) => sum + Math.max(1, f.pages), 0);

      setUploadedFiles(nextList);
      setClientRequestId(newRequestId());
      setPrinting((prev) => ({
        ...prev,
        bwPages:
          prev.printType === 'mixed'
            ? Math.min(prev.bwPages, nextTotalPages)
            : prev.printType === 'color'
              ? 0
              : nextTotalPages,
        colorPages:
          prev.printType === 'mixed'
            ? Math.max(0, nextTotalPages - Math.min(prev.bwPages, nextTotalPages))
            : prev.printType === 'color'
              ? nextTotalPages
              : 0,
      }));
    } catch (err) {
      parsedBatch.forEach((p) => {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      });
      setFileError(err instanceof Error ? err.message : 'Unable to read selected document.');
    } finally {
      setParsingFiles(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = (localId: string) => {
    setUploadedFiles((prev) => {
      const target = prev.find((f) => f.localId === localId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      const next = prev.filter((f) => f.localId !== localId);
      const nextTotal = Math.max(1, next.reduce((s, f) => s + Math.max(1, f.pages), 0));
      setPrinting((p) => ({
        ...p,
        bwPages: p.printType === 'color' ? 0 : Math.min(p.bwPages, nextTotal),
        colorPages: p.printType === 'bw' ? 0 : Math.max(0, nextTotal - Math.min(p.bwPages, nextTotal)),
      }));
      return next;
    });
    if (activePreviewId === localId) setActivePreviewId(null);
    setWhatsappSessionReady(null);
    setClientRequestId(newRequestId());
  };

  const handleUpdateDocPages = (localId: string, pages: number) => {
    const safePages = Math.min(2000, Math.max(1, Math.round(pages || 1)));
    setUploadedFiles((prev) => {
      const next = prev.map((f) => (f.localId === localId ? { ...f, pages: safePages } : f));
      const nextTotal = next.reduce((s, f) => s + Math.max(1, f.pages), 0);
      setPrinting((p) => ({
        ...p,
        bwPages: p.printType === 'bw' ? nextTotal : p.printType === 'color' ? 0 : Math.min(p.bwPages, nextTotal),
        colorPages: p.printType === 'color' ? nextTotal : p.printType === 'bw' ? 0 : Math.max(0, nextTotal - Math.min(p.bwPages, nextTotal)),
      }));
      return next;
    });
    setWhatsappSessionReady(null);
  };

  const handlePrintTypeChange = (nextType: PrintType) => {
    setPrinting((prev) => {
      if (nextType === 'bw') {
        return { ...prev, printType: 'bw', bwPages: effectivePageCount, colorPages: 0 };
      }
      if (nextType === 'color') {
        return { ...prev, printType: 'color', bwPages: 0, colorPages: effectivePageCount };
      }
      const bw = Math.min(effectivePageCount, Math.max(0, prev.bwPages || Math.ceil(effectivePageCount / 2)));
      return {
        ...prev,
        printType: 'mixed',
        bwPages: bw,
        colorPages: Math.max(0, effectivePageCount - bw),
      };
    });
  };

  const handleMixedBwPagesChange = (raw: number) => {
    const clampedBw = Math.min(effectivePageCount, Math.max(0, Math.round(raw || 0)));
    setPrinting((prev) => ({
      ...prev,
      bwPages: clampedBw,
      colorPages: Math.max(0, effectivePageCount - clampedBw),
    }));
  };

  const handleCopiesChange = (next: number) => {
    setPrinting((prev) => ({
      ...prev,
      copies: Math.min(200, Math.max(1, Math.round(next || 1))),
    }));
  };

  const handleEnvelopeQtyChange = (next: number) => {
    setPrinting((prev) => ({
      ...prev,
      envelopeQuantity: Math.min(200, Math.max(0, Math.round(next || 0))),
    }));
  };

  const buildEffectiveLocation = () =>
    delivery.method === 'campus_delivery' &&
    delivery.location === 'Hostel / Off-Campus Address' &&
    customOffCampusAddress.trim()
      ? `Off-Campus: ${customOffCampusAddress.trim()}`
      : delivery.method === 'shop_pickup'
        ? 'Print Shop Pickup'
        : delivery.location;

  const openWhatsappExternal = (url: string) => {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const buildSelectedServiceNames = (): string[] =>
    selectedServiceIds
      .map((id) => servicesCatalog.find((s) => s.id === id)?.name || id)
      .filter(Boolean);

  // Upload-first "CONTINUE ON WHATSAPP" handler:
  // Uploads file(s) to Firebase Storage -> gets download URL -> saves order to Firestore -> opens https://wa.me/23279576978
  const handleContinueOnWhatsapp = async () => {
    if (startingWhatsapp || submitting) return;
    setFileError(null);
    setSubmitError(null);

    if (uploadedFiles.length === 0) {
      setFileError('Please upload at least one PDF, DOC, or DOCX document first.');
      return;
    }

    if (whatsappSessionReady) {
      openWhatsappExternal(whatsappSessionReady.whatsappContinueUrl);
      return;
    }

    setStartingWhatsapp(true);
    setUploadProgress(5);

    try {
      const orderId = generateOrderReference();
      const effectiveLocation = buildEffectiveLocation();
      const finishingLabel =
        FINISHING_OPTIONS.find((f) => f.id === printing.finishing)?.label || printing.finishing;

      const sessionCustomer: CustomerDetails = {
        fullName: customer.fullName.trim() || 'Pending via WhatsApp',
        studentId: customer.studentId.trim() || 'Pending',
        institution: effectiveInstitution || 'Pending via WhatsApp',
        department: customer.department.trim() || 'Pending via WhatsApp',
        course: customer.course.trim() || 'Pending via WhatsApp',
        lecturerName: customer.lecturerName.trim() || 'Pending via WhatsApp',
        assignmentTitle:
          customer.assignmentTitle.trim() ||
          uploadedFiles[0]?.file.name ||
          'Uploaded Document',
        whatsappPhone: customer.whatsappPhone.trim() || 'WhatsApp',
        ...(customer.altPhone?.trim() ? { altPhone: customer.altPhone.trim() } : {}),
      };

      const envelopeHtml = buildEnvelopeLabelHtml({
        orderId,
        customer: sessionCustomer,
        copies: printing.copies,
        finishingLabel,
        envelopeQuantity: printing.envelopeQuantity,
        note: envelopeNote.trim(),
      });

      // 1. Upload documents + label directly to Firebase Storage and retrieve download URLs
      const storageRes = await uploadFilesToFirebaseStorageWithProgress(
        orderId,
        uploadedFiles.map((f) => f.file),
        envelopeHtml,
        (pct) => setUploadProgress(pct),
      );

      if (storageRes.uploaded.length !== uploadedFiles.length) {
        throw new Error('Document upload to Firebase Storage was incomplete. Please try again.');
      }

      const documents: UploadedDocumentItem[] = uploadedFiles.map((f, idx) => ({
        fileId: `file_${idx + 1}`,
        filename: f.file.name,
        mimeType: f.mimeType,
        extension: f.extension,
        pages: Math.max(1, f.pages),
        sizeBytes: f.file.size,
        storagePath: storageRes.uploaded[idx].storagePath,
        secureDownloadUrl: storageRes.uploaded[idx].downloadUrl,
      }));

      const totalPages = documents.reduce((s, d) => s + d.pages, 0);
      const totalBytes = documents.reduce((s, d) => s + d.sizeBytes, 0);
      const firstDoc = documents[0];
      const summaryFilename =
        documents.length > 1
          ? `${firstDoc.filename} (+${documents.length - 1} more)`
          : firstDoc.filename;
      const nowIso = new Date().toISOString();

      let orderRecord: PrintOrderRecord = {
        orderId,
        clientRequestId,
        submissionMode: 'whatsapp_session',
        status: 'ORDER RECEIVED',
        customer: sessionCustomer,
        document: {
          filename: summaryFilename.slice(0, 180),
          pages: totalPages,
          sizeBytes: totalBytes,
          storagePath: firstDoc.storagePath,
          secureDownloadUrl: firstDoc.secureDownloadUrl,
        },
        documents,
        selectedServices: selectedServiceIds,
        printing: {
          ...printing,
          bwPages:
            printing.printType === 'bw'
              ? totalPages
              : printing.printType === 'color'
                ? 0
                : Math.min(totalPages, printing.bwPages),
          colorPages:
            printing.printType === 'bw'
              ? 0
              : Math.max(
                  0,
                  totalPages -
                    (printing.printType === 'color' ? 0 : Math.min(totalPages, printing.bwPages)),
                ),
        },
        pricing: livePricing,
        payment: {
          method: selectedPayment || 'payment_on_delivery',
          status: 'PENDING',
          reference: paymentReference.trim(),
        },
        delivery: {
          ...delivery,
          location: effectiveLocation,
        },
        envelopeLabel: {
          storagePath: storageRes.labelStoragePath || `orders/${orderId}/envelope-label.html`,
          secureLabelUrl: storageRes.labelDownloadUrl || '',
          note: envelopeNote.trim(),
        },
        whatsappNotification: { status: 'PENDING', lastError: '', attempts: 0 },
        emailNotification: { status: 'PENDING', lastError: '', attempts: 0 },
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      // 2. Persist order record to Firestore
      let firestoreSaved = true;
      try {
        await saveOrderToFirestore(orderRecord);
      } catch (fsErr) {
        console.warn('Firestore save warning:', fsErr);
        firestoreSaved = false;
      }

      // 3. Best-effort sync to Express backend (if active) so Email & Bot Bridge receive the session & Firebase URL
      const backendPayload: UploadSessionPayload = {
        clientRequestId,
        preferredOrderId: orderId,
        files: uploadedFiles.map((f, idx) => ({
          fileBase64: f.base64,
          filename: f.file.name,
          mimeType: f.mimeType,
          sizeBytes: f.file.size,
          pages: f.pages,
          storagePath: documents[idx].storagePath,
          firebaseDownloadUrl: documents[idx].secureDownloadUrl,
        })),
        customer: {
          fullName: customer.fullName.trim() || undefined,
          studentId: customer.studentId.trim() || undefined,
          institution: effectiveInstitution || undefined,
          department: customer.department.trim() || undefined,
          course: customer.course.trim() || undefined,
          lecturerName: customer.lecturerName.trim() || undefined,
          assignmentTitle: customer.assignmentTitle.trim() || undefined,
          whatsappPhone: customer.whatsappPhone.trim() || undefined,
          altPhone: customer.altPhone?.trim() || undefined,
        },
        printing: orderRecord.printing,
        selectedServices: selectedServiceIds,
        delivery: orderRecord.delivery,
        envelopeNote: envelopeNote.trim(),
        labelDownloadUrl: storageRes.labelDownloadUrl || undefined,
      };

      const backendRes = await trySyncBackendJson<{
        order: PrintOrderRecord;
        orderViewUrl: string;
      }>('/api/upload-session', backendPayload);

      let orderViewSearch = '';
      if (backendRes?.order) {
        orderRecord = {
          ...orderRecord,
          emailNotification: backendRes.order.emailNotification || orderRecord.emailNotification,
        };
        try {
          orderViewSearch = new URL(backendRes.orderViewUrl).search;
        } catch {
          orderViewSearch = '';
        }
      }

      cacheOrderForSession(orderRecord);

      // 4. Construct direct https://wa.me/23279576978 URL with Order Reference, Firebase Document URL(s), and available student info
      const whatsappContinueUrl = buildWhatsappOrderUrl({
        orderId,
        documents,
        customer: customerForPreview,
        printing: orderRecord.printing,
        pricing: orderRecord.pricing,
        delivery: orderRecord.delivery,
        payment: selectedPayment ? orderRecord.payment : undefined,
        selectedServiceNames: buildSelectedServiceNames(),
        envelopeNote: envelopeNote.trim(),
      });

      setWhatsappSessionReady({
        order: orderRecord,
        whatsappContinueUrl,
        orderViewSearch,
      });

      setConfirmation({
        order: orderRecord,
        orderViewSearch,
        whatsappContinueUrl,
        firestoreSaved,
      });

      openWhatsappExternal(whatsappContinueUrl);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Unable to upload document and start WhatsApp session. Please try again.';
      setFileError(msg);
      setSubmitError(msg);
      setUploadProgress(0);
    } finally {
      setStartingWhatsapp(false);
    }
  };

  // Full Order Now submit handler with explicit validation for uploaded files & missing student details
  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || startingWhatsapp) return;
    setSubmitError(null);
    setFileError(null);

    if (uploadedFiles.length === 0) {
      const msg = 'Please upload at least one PDF, DOC, or DOCX document before placing your order.';
      setFileError(msg);
      setSubmitError(msg);
      return;
    }

    const trimmedCustomer: CustomerDetails = {
      fullName: customer.fullName.trim(),
      studentId: customer.studentId.trim(),
      institution: effectiveInstitution,
      department: customer.department.trim(),
      course: customer.course.trim(),
      lecturerName: customer.lecturerName.trim(),
      assignmentTitle: customer.assignmentTitle.trim(),
      whatsappPhone: customer.whatsappPhone.trim(),
      altPhone: customer.altPhone?.trim() || '',
    };

    const missingFields: string[] = [];
    if (!trimmedCustomer.fullName) missingFields.push('Full Name');
    if (!trimmedCustomer.studentId) missingFields.push('Student ID');
    if (!trimmedCustomer.institution) missingFields.push('School or University');
    if (!trimmedCustomer.department) missingFields.push('Department / Faculty');
    if (!trimmedCustomer.course) missingFields.push('Course or Subject');
    if (!trimmedCustomer.lecturerName) missingFields.push("Lecturer's Name");
    if (!trimmedCustomer.assignmentTitle) missingFields.push('Assignment Title');
    if (!trimmedCustomer.whatsappPhone) missingFields.push('Phone / WhatsApp Number');
    if (
      delivery.method === 'campus_delivery' &&
      delivery.location === 'Hostel / Off-Campus Address' &&
      !customOffCampusAddress.trim()
    ) {
      missingFields.push('Hostel / Street Address');
    }

    if (missingFields.length > 0) {
      setSubmitError(
        `Missing required student information: ${missingFields.join(', ')}. Complete these fields or click "CONTINUE ON WHATSAPP" under Document Upload to send your file now and finish details in chat.`,
      );
      return;
    }

    if (!selectedPayment) {
      setSubmitError(
        'Please select a payment option (Orange Money, Africell Money, or Payment on Delivery) before submitting your order.',
      );
      return;
    }

    setSubmitting(true);
    setUploadProgress(5);

    try {
      const orderId = generateOrderReference();
      const effectiveLocation = buildEffectiveLocation();
      const finishingLabel =
        FINISHING_OPTIONS.find((f) => f.id === printing.finishing)?.label || printing.finishing;

      const envelopeHtml = buildEnvelopeLabelHtml({
        orderId,
        customer: trimmedCustomer,
        copies: printing.copies,
        finishingLabel,
        envelopeQuantity: printing.envelopeQuantity,
        note: envelopeNote.trim(),
      });

      // 1. Upload documents + label to Firebase Storage first and get real download URLs
      const storageRes = await uploadFilesToFirebaseStorageWithProgress(
        orderId,
        uploadedFiles.map((f) => f.file),
        envelopeHtml,
        (pct) => setUploadProgress(pct),
      );

      if (storageRes.uploaded.length !== uploadedFiles.length) {
        throw new Error('Document upload to Firebase Storage failed. Please try again.');
      }

      const documents: UploadedDocumentItem[] = uploadedFiles.map((f, idx) => ({
        fileId: `file_${idx + 1}`,
        filename: f.file.name,
        mimeType: f.mimeType,
        extension: f.extension,
        pages: Math.max(1, f.pages),
        sizeBytes: f.file.size,
        storagePath: storageRes.uploaded[idx].storagePath,
        secureDownloadUrl: storageRes.uploaded[idx].downloadUrl,
      }));

      const totalPages = documents.reduce((s, d) => s + d.pages, 0);
      const totalBytes = documents.reduce((s, d) => s + d.sizeBytes, 0);
      const firstDoc = documents[0];
      const summaryFilename =
        documents.length > 1
          ? `${firstDoc.filename} (+${documents.length - 1} more)`
          : firstDoc.filename;
      const nowIso = new Date().toISOString();

      let orderRecord: PrintOrderRecord = {
        orderId,
        clientRequestId,
        submissionMode: 'web_checkout',
        status: 'ORDER RECEIVED',
        customer: trimmedCustomer,
        document: {
          filename: summaryFilename.slice(0, 180),
          pages: totalPages,
          sizeBytes: totalBytes,
          storagePath: firstDoc.storagePath,
          secureDownloadUrl: firstDoc.secureDownloadUrl,
        },
        documents,
        selectedServices: selectedServiceIds,
        printing: {
          ...printing,
          bwPages:
            printing.printType === 'bw'
              ? totalPages
              : printing.printType === 'color'
                ? 0
                : Math.min(totalPages, printing.bwPages),
          colorPages:
            printing.printType === 'bw'
              ? 0
              : Math.max(
                  0,
                  totalPages -
                    (printing.printType === 'color' ? 0 : Math.min(totalPages, printing.bwPages)),
                ),
        },
        pricing: livePricing,
        payment: {
          method: selectedPayment,
          status: 'PENDING',
          reference: paymentReference.trim(),
        },
        delivery: {
          ...delivery,
          location: effectiveLocation,
        },
        envelopeLabel: {
          storagePath: storageRes.labelStoragePath || `orders/${orderId}/envelope-label.html`,
          secureLabelUrl: storageRes.labelDownloadUrl || '',
          note: envelopeNote.trim(),
        },
        whatsappNotification: { status: 'PENDING', lastError: '', attempts: 0 },
        emailNotification: { status: 'PENDING', lastError: '', attempts: 0 },
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      // 2. Persist order record to Firestore
      let firestoreSaved = true;
      try {
        await saveOrderToFirestore(orderRecord);
      } catch (fsErr) {
        console.warn('Firestore order save issue:', fsErr);
        firestoreSaved = false;
      }

      // 3. Best-effort sync to Express backend (when active) for email to badax1010@gmail.com & WhatsApp Cloud API
      const backendPayload: SubmitOrderPayload = {
        clientRequestId,
        preferredOrderId: orderId,
        files: uploadedFiles.map((f, idx) => ({
          fileBase64: f.base64,
          filename: f.file.name,
          mimeType: f.mimeType,
          sizeBytes: f.file.size,
          pages: f.pages,
          storagePath: documents[idx].storagePath,
          firebaseDownloadUrl: documents[idx].secureDownloadUrl,
        })),
        customer: trimmedCustomer,
        printing: orderRecord.printing,
        selectedServices: selectedServiceIds,
        payment: {
          method: selectedPayment,
          reference: paymentReference.trim(),
        },
        delivery: orderRecord.delivery,
        envelopeNote: envelopeNote.trim(),
        currency: activeCurrency,
        storagePath: firstDoc.storagePath,
        labelStoragePath: storageRes.labelStoragePath,
        labelDownloadUrl: storageRes.labelDownloadUrl,
      };

      const backendRes = await trySyncBackendJson<{
        order: PrintOrderRecord;
        orderViewUrl: string;
      }>('/api/orders', backendPayload);

      let orderViewSearch = '';
      if (backendRes?.order) {
        orderRecord = {
          ...orderRecord,
          whatsappNotification:
            backendRes.order.whatsappNotification || orderRecord.whatsappNotification,
          emailNotification:
            backendRes.order.emailNotification || orderRecord.emailNotification,
        };
        try {
          orderViewSearch = new URL(backendRes.orderViewUrl).search;
        } catch {
          orderViewSearch = '';
        }
      }

      cacheOrderForSession(orderRecord);

      // 4. Construct direct https://wa.me/23279576978 URL with Order ID, Firebase Storage URLs & full student info
      const whatsappContinueUrl = buildWhatsappOrderUrl({
        orderId,
        documents,
        customer: trimmedCustomer,
        printing: orderRecord.printing,
        pricing: orderRecord.pricing,
        delivery: orderRecord.delivery,
        payment: orderRecord.payment,
        selectedServiceNames: buildSelectedServiceNames(),
        envelopeNote: envelopeNote.trim(),
      });

      setConfirmation({
        order: orderRecord,
        orderViewSearch,
        whatsappContinueUrl,
        firestoreSaved,
      });

      openWhatsappExternal(whatsappContinueUrl);
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Failed to upload documents or submit order. Please try again.',
      );
      setUploadProgress(0);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartNewOrder = () => {
    uploadedFiles.forEach((f) => {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    });
    setUploadedFiles([]);
    setActivePreviewId(null);
    setSelectedPayment(null);
    setPaymentReference('');
    setConfirmation(null);
    setWhatsappSessionReady(null);
    setUploadProgress(0);
    setSubmitError(null);
    setFileError(null);
    setClientRequestId(newRequestId());
  };

  if (confirmation) {
    const { order, orderViewSearch, whatsappContinueUrl, firestoreSaved } = confirmation;
    const finishingLabel =
      FINISHING_OPTIONS.find((f) => f.id === order.printing.finishing)?.label ||
      order.printing.finishing;
    const paymentLabel =
      PAYMENT_OPTIONS.find((p) => p.id === order.payment.method)?.label ||
      order.payment.method;

    return (
      <section id="print-studio" className="max-w-[1240px] mx-auto px-6 py-16">
        <div className="rounded-xl border border-[#D4D0C8] bg-white p-8 max-w-4xl mx-auto shadow-xs">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E5E3DE] pb-6">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-mono text-emerald-700 font-semibold uppercase tracking-wider">
                <CheckCircle2 className="w-4 h-4" />
                Order Submitted · {order.status}
              </div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#141413] mt-2">
                Order Reference: <span className="font-mono">{order.orderId}</span>
              </h2>
              <p className="text-sm text-[#57544E] mt-1">
                Your documents, printing preferences, and brown envelope label have been submitted safely.
              </p>
            </div>
            <button
              type="button"
              onClick={handleStartNewOrder}
              className="px-4 py-2 text-sm font-medium border border-[#D4D0C8] text-[#141413] rounded-lg hover:bg-[#F3F1EC] transition-colors whitespace-nowrap shrink-0"
            >
              Submit Another Order
            </button>
          </div>

          <div className="mt-6 space-y-3">
            {order.emailNotification?.status === 'SENT' && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                Order email with your uploaded documents and personalized envelope label has been sent directly to DEE PRINTS.
              </div>
            )}

            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-sm text-emerald-950 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">
                  Documents uploaded to Firebase Storage &amp; ready on WhatsApp
                </p>
                <p className="text-xs text-emerald-800 mt-0.5">
                  Your order reference <span className="font-mono font-semibold">{order.orderId}</span> and uploaded file link are pre-filled—tap below if WhatsApp did not open automatically.
                </p>
              </div>
              <a
                href={whatsappContinueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors whitespace-nowrap shrink-0"
              >
                <MessageSquare className="w-4 h-4" />
                OPEN WHATSAPP LINE
              </a>
            </div>

            {!firestoreSaved && (
              <div className="rounded-lg border border-[#E5E3DE] bg-[#F3F1EC] px-4 py-3 text-xs text-[#57544E]">
                Order was recorded in the backend vault. Cloud sync will complete when Admin opens the dashboard.
              </div>
            )}
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
            <div className="md:col-span-6 space-y-4">
              <div className="rounded-xl border border-[#E5E3DE] bg-[#FAF9F7] p-5">
                <h3 className="font-display text-sm font-semibold text-[#141413] mb-3">
                  Order Summary
                </h3>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#57544E]">Documents</dt>
                    <dd className="font-medium text-[#141413] truncate">
                      {order.documents?.length || 1} file(s) · {order.document.pages} pages
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#57544E]">Copies &amp; Finishing</dt>
                    <dd className="font-medium text-[#141413]">
                      {order.printing.copies}x · {finishingLabel}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#57544E]">Payment Option</dt>
                    <dd className="font-medium text-[#141413]">
                      {paymentLabel} · <span className="font-mono text-xs">{order.payment.status}</span>
                    </dd>
                  </div>
                  <div className="pt-2 border-t border-[#E5E3DE] flex justify-between gap-3">
                    <dt className="font-semibold text-[#141413]">Total</dt>
                    <dd className="font-mono font-bold text-[#141413] tabular-nums">
                      {order.pricing.currency} {order.pricing.total.toLocaleString()}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => onOpenOrderSheet(order.orderId, orderViewSearch)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#141413] rounded-lg hover:bg-[#2C2A27] transition-colors"
                >
                  Open Printable Job Sheet &amp; Envelope
                </button>
                {onOpenTrack && (
                  <button
                    type="button"
                    onClick={() => onOpenTrack(order.orderId)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-[#141413] border border-[#D4D0C8] bg-white rounded-lg hover:bg-[#F3F1EC] transition-colors"
                  >
                    Track Order Progress
                  </button>
                )}
              </div>
            </div>

            <div className="md:col-span-6">
              <EnvelopePreview
                customer={order.customer}
                envelopeQuantity={order.printing.envelopeQuantity}
                copies={order.printing.copies}
                finishingLabel={finishingLabel}
                envelopeNote={order.envelopeLabel.note}
                orderId={order.orderId}
              />
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="print-studio" className="max-w-[1240px] mx-auto px-6 py-16">
      <div className="max-w-2xl mb-10">
        <p className="text-xs font-mono text-[#6B6760] uppercase tracking-wider">
          Automated Student Print Studio · Upload Once, Continue Anywhere
        </p>
        <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-[#141413] mt-2 text-balance">
          Upload your PDF or Word files, then continue on WhatsApp or submit online.
        </h2>
        <p className="mt-3 text-base text-[#57544E] leading-relaxed">
          Upload one or more PDF, DOC, or DOCX documents. You can jump straight to WhatsApp with your Order Reference without re-uploading files, or complete your brown envelope and payment online right here.
        </p>
      </div>

      <form onSubmit={handleSubmitOrder} className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        {/* Left Column */}
        <div className="lg:col-span-7 space-y-10">
          {/* 01. Multi-File Document Upload (PDF, DOC, DOCX) */}
          <div className="pb-10 border-b border-[#E5E3DE]">
            <div className="flex items-baseline justify-between gap-4 mb-4">
              <h3 className="font-display text-xl font-semibold text-[#141413]">
                01. Document Upload (PDF, DOC, DOCX)
              </h3>
              <span className="text-xs font-mono text-[#6B6760] tabular-nums">
                {uploadedFiles.length > 0
                  ? `${uploadedFiles.length} file(s) · ${totalDetectedPages} total pages`
                  : `Up to ${MAX_FILES} files · Max 20 MB each`}
              </span>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                void handleFilesSelected(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              className={`cursor-pointer rounded-xl border-2 border-dashed p-7 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8232C] ${
                isDragging
                  ? 'border-[#C8232C] bg-[#C8232C]/5'
                  : 'border-[#CBC7BE] bg-white hover:border-[#141413]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
                className="sr-only"
                onChange={(e) => void handleFilesSelected(e.target.files)}
              />
              <div className="w-11 h-11 rounded-lg bg-[#F3F1EC] flex items-center justify-center mx-auto mb-3">
                {parsingFiles ? (
                  <Loader2 className="w-5 h-5 text-[#141413] animate-spin" />
                ) : (
                  <UploadCloud className="w-5 h-5 text-[#141413]" />
                )}
              </div>
              <p className="text-sm font-semibold text-[#141413]">
                {parsingFiles
                  ? 'Validating documents & counting pages...'
                  : uploadedFiles.length > 0
                    ? 'Click or drag to add more PDF, DOC, or DOCX files'
                    : 'Click to upload or drag & drop PDF, DOC, or DOCX files'}
              </p>
              <p className="mt-1 text-xs text-[#6B6760]">
                Supports multiple documents · Auto-detects PDF pages · Securely linked to your Order ID
              </p>
            </div>

            {/* Uploaded Files List */}
            {uploadedFiles.length > 0 && (
              <div className="mt-4 space-y-3">
                {uploadedFiles.map((item) => {
                  const isPreviewOpen = activePreviewId === item.localId;
                  return (
                    <div
                      key={item.localId}
                      className="rounded-xl border border-[#D4D0C8] bg-white overflow-hidden"
                    >
                      <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-lg bg-[#F3F1EC] border border-[#E5E3DE] flex items-center justify-center shrink-0">
                            <FileText className="w-4 h-4 text-[#C8232C]" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#141413] truncate">
                              {item.file.name}
                            </p>
                            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-[#6B6760] tabular-nums mt-0.5">
                              <span>{item.extension.toUpperCase()}</span>
                              <span>·</span>
                              {item.extension === 'pdf' ? (
                                <span>
                                  {item.pages} {item.pages === 1 ? 'page' : 'pages'} detected
                                </span>
                              ) : (
                                <label className="inline-flex items-center gap-1">
                                  <span>Pages:</span>
                                  <input
                                    type="number"
                                    min={1}
                                    max={2000}
                                    value={item.pages}
                                    onChange={(e) =>
                                      handleUpdateDocPages(item.localId, Number(e.target.value))
                                    }
                                    className="w-14 rounded border border-[#D4D0C8] px-1.5 py-0.5 text-xs text-[#141413]"
                                  />
                                </label>
                              )}
                              <span>·</span>
                              <span>{formatBytes(item.file.size)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {item.previewUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                setActivePreviewId(isPreviewOpen ? null : item.localId)
                              }
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#141413] border border-[#D4D0C8] rounded-md hover:bg-[#F3F1EC] transition-colors"
                            >
                              {isPreviewOpen ? (
                                <EyeOff className="w-3.5 h-3.5" />
                              ) : (
                                <Eye className="w-3.5 h-3.5" />
                              )}
                              {isPreviewOpen ? 'Hide' : 'Preview'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemoveFile(item.localId)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#C8232C] border border-[#E5E3DE] rounded-md hover:bg-[#F3F1EC] transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Remove
                          </button>
                        </div>
                      </div>

                      {isPreviewOpen && item.previewUrl && (
                        <div className="border-t border-[#E5E3DE] bg-[#F3F1EC] p-3">
                          <iframe
                            title={`Preview of ${item.file.name}`}
                            src={item.previewUrl}
                            className="w-full h-[360px] rounded-md border border-[#D4D0C8] bg-white"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Upload Progress Bar */}
            {(startingWhatsapp || submitting || uploadProgress > 0) && (
              <div className="mt-4 rounded-lg border border-[#E5E3DE] bg-white p-3.5">
                <div className="flex items-center justify-between text-xs font-mono text-[#141413] mb-1.5">
                  <span>
                    {uploadProgress >= 100
                      ? 'Upload Confirmed & Saved'
                      : 'Uploading documents securely...'}
                  </span>
                  <span className="tabular-nums font-semibold">{uploadProgress}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-[#EFECE6] overflow-hidden">
                  <div
                    className={`h-full transition-all duration-200 ${
                      uploadProgress >= 100 ? 'bg-emerald-600' : 'bg-[#C8232C]'
                    }`}
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Immediate Upload-First "CONTINUE ON WHATSAPP" Card */}
            {uploadedFiles.length > 0 && (
              <div className="mt-5 rounded-xl border border-[#141413]/20 bg-[#FAF9F7] p-5">
                {whatsappSessionReady ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-emerald-700 text-xs font-mono font-semibold uppercase">
                      <CheckCircle2 className="w-4 h-4" />
                      Upload Successful · Order Reference {whatsappSessionReady.order.orderId}
                    </div>
                    <p className="text-sm text-[#141413]">
                      Your document(s) are saved. Tap below to open WhatsApp with your Order Reference pre-filled—our bot already has your files!
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <a
                        href={whatsappSessionReady.whatsappContinueUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors"
                      >
                        <MessageSquare className="w-4 h-4" />
                        CONTINUE ON WHATSAPP
                      </a>
                      {onOpenTrack && (
                        <button
                          type="button"
                          onClick={() => onOpenTrack(whatsappSessionReady.order.orderId)}
                          className="px-4 py-2.5 text-xs font-semibold text-[#141413] border border-[#D4D0C8] bg-white rounded-lg hover:bg-[#F3F1EC]"
                        >
                          Track Order ({whatsappSessionReady.order.orderId})
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <p className="font-display text-sm font-semibold text-[#141413]">
                        Fast Option: Complete Order via DEE PRINTS WhatsApp Bot
                      </p>
                      <p className="text-xs text-[#57544E] mt-1">
                        Skip filling the full form below—save your uploaded document(s) now and finish details conversationally on WhatsApp.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={startingWhatsapp || parsingFiles}
                      onClick={() => void handleContinueOnWhatsapp()}
                      className="inline-flex items-center justify-center gap-2 px-5 py-3 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
                    >
                      {startingWhatsapp ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Saving Upload...
                        </>
                      ) : (
                        <>
                          <MessageSquare className="w-4 h-4" />
                          CONTINUE ON WHATSAPP
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {fileError && (
              <p role="alert" className="mt-3 text-sm text-[#C8232C] font-medium flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {fileError}
              </p>
            )}
          </div>

          {/* 02. Customer & Academic Details (Feeds Brown Envelope Label Automatically) */}
          <div id="envelope-section" className="pb-10 border-b border-[#E5E3DE]">
            <h3 className="font-display text-xl font-semibold text-[#141413] mb-2">
              02. Student &amp; Envelope Label Details
            </h3>
            <p className="text-sm text-[#57544E] mb-5">
              Complete these fields to personalize your brown envelope label and submit directly online (optional if you prefer to complete via WhatsApp above).
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="full-name" className="block text-sm font-medium text-[#141413] mb-1.5">
                  Full Name
                </label>
                <input
                  id="full-name"
                  type="text"
                  value={customer.fullName}
                  onChange={(e) => setCustomer((p) => ({ ...p, fullName: e.target.value }))}
                  placeholder="e.g., Aminata Kamara"
                  className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm text-[#141413] placeholder:text-[#8A857C] focus:border-[#141413] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="student-id" className="block text-sm font-medium text-[#141413] mb-1.5">
                  Student ID
                </label>
                <input
                  id="student-id"
                  type="text"
                  value={customer.studentId}
                  onChange={(e) => setCustomer((p) => ({ ...p, studentId: e.target.value }))}
                  placeholder="e.g., LKW-2026-0418"
                  className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm font-mono text-[#141413] placeholder:font-sans placeholder:text-[#8A857C] focus:border-[#141413] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="institution-select" className="block text-sm font-medium text-[#141413] mb-1.5">
                  School or University
                </label>
                <select
                  id="institution-select"
                  value={institutionChoice}
                  onChange={(e) => {
                    const val = e.target.value;
                    setInstitutionChoice(val);
                    if (val !== 'Other College / University') {
                      setCustomer((p) => ({ ...p, institution: val }));
                    }
                  }}
                  className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm text-[#141413] focus:border-[#141413] focus:outline-none"
                >
                  {DEFAULT_INSTITUTIONS.map((inst) => (
                    <option key={inst} value={inst}>
                      {inst}
                    </option>
                  ))}
                </select>
              </div>

              {institutionChoice === 'Other College / University' && (
                <div>
                  <label htmlFor="custom-institution" className="block text-sm font-medium text-[#141413] mb-1.5">
                    Institution Name
                  </label>
                  <input
                    id="custom-institution"
                    type="text"
                    value={customInstitution}
                    onChange={(e) => setCustomInstitution(e.target.value)}
                    placeholder="Enter your school or university"
                    className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm text-[#141413] placeholder:text-[#8A857C] focus:border-[#141413] focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label htmlFor="whatsapp-phone" className="block text-sm font-medium text-[#141413] mb-1.5">
                  Phone / WhatsApp Number
                </label>
                <input
                  id="whatsapp-phone"
                  type="tel"
                  value={customer.whatsappPhone}
                  onChange={(e) => setCustomer((p) => ({ ...p, whatsappPhone: e.target.value }))}
                  placeholder="e.g., 076 123 456"
                  className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm font-mono text-[#141413] placeholder:font-sans placeholder:text-[#8A857C] focus:border-[#141413] focus:outline-none"
                />
              </div>

              <div className={institutionChoice === 'Other College / University' ? 'sm:col-span-2' : ''}>
                <label htmlFor="alt-phone" className="block text-sm font-medium text-[#141413] mb-1.5">
                  Alternative Contact Number (Optional)
                </label>
                <input
                  id="alt-phone"
                  type="tel"
                  value={customer.altPhone || ''}
                  onChange={(e) => setCustomer((p) => ({ ...p, altPhone: e.target.value }))}
                  placeholder="Optional backup number"
                  className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm font-mono text-[#141413] placeholder:font-sans placeholder:text-[#8A857C] focus:border-[#141413] focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="department-input" className="block text-sm font-medium text-[#141413] mb-1.5">
                  Department / Faculty
                </label>
                <input
                  id="department-input"
                  list="department-suggestions"
                  type="text"
                  value={customer.department}
                  onChange={(e) => setCustomer((p) => ({ ...p, department: e.target.value }))}
                  placeholder="Select or type your department"
                  className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm text-[#141413] placeholder:text-[#8A857C] focus:border-[#141413] focus:outline-none"
                />
                <datalist id="department-suggestions">
                  {LIMKOKWING_DEPARTMENTS.map((dept) => (
                    <option key={dept} value={dept} />
                  ))}
                </datalist>
              </div>

              <div>
                <label htmlFor="course-input" className="block text-sm font-medium text-[#141413] mb-1.5">
                  Course or Subject
                </label>
                <input
                  id="course-input"
                  type="text"
                  value={customer.course}
                  onChange={(e) => setCustomer((p) => ({ ...p, course: e.target.value }))}
                  placeholder="e.g., DES 302 — Publication Design"
                  className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm text-[#141413] placeholder:text-[#8A857C] focus:border-[#141413] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="lecturer-input" className="block text-sm font-medium text-[#141413] mb-1.5">
                  Lecturer’s Name
                </label>
                <input
                  id="lecturer-input"
                  type="text"
                  value={customer.lecturerName}
                  onChange={(e) => setCustomer((p) => ({ ...p, lecturerName: e.target.value }))}
                  placeholder="e.g., Mr. Ibrahim Sesay"
                  className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm text-[#141413] placeholder:text-[#8A857C] focus:border-[#141413] focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="assignment-title" className="block text-sm font-medium text-[#141413] mb-1.5">
                  Assignment Title
                </label>
                <input
                  id="assignment-title"
                  type="text"
                  value={customer.assignmentTitle}
                  onChange={(e) => setCustomer((p) => ({ ...p, assignmentTitle: e.target.value }))}
                  placeholder="e.g., Brand Identity & Editorial Systems Report"
                  className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm text-[#141413] placeholder:text-[#8A857C] focus:border-[#141413] focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="envelope-note" className="block text-sm font-medium text-[#141413] mb-1.5">
                  Envelope Handling Note (Optional)
                </label>
                <input
                  id="envelope-note"
                  type="text"
                  value={envelopeNote}
                  onChange={(e) => setEnvelopeNote(e.target.value)}
                  placeholder="e.g., Attn: Faculty Registry · Do Not Fold"
                  className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm text-[#141413] placeholder:text-[#8A857C] focus:border-[#141413] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* 03. Printing Services & Preferences */}
          <div className="pb-10 border-b border-[#E5E3DE]">
            <h3 className="font-display text-xl font-semibold text-[#141413] mb-5">
              03. Printing Services &amp; Preferences
            </h3>

            {/* Selectable Printing Services Catalog */}
            <div className="mb-6">
              <span className="block text-sm font-medium text-[#141413] mb-2">
                Select Required Services (Managed by Studio Admin)
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {servicesCatalog
                  .filter((svc) => svc.enabled)
                  .map((svc) => {
                    const checked = selectedServiceIds.includes(svc.id);
                    return (
                      <button
                        key={svc.id}
                        type="button"
                        onClick={() => toggleServiceSelection(svc.id)}
                        className={`text-left rounded-lg border p-3 transition-colors ${
                          checked
                            ? 'border-[#141413] bg-white shadow-xs'
                            : 'border-[#E5E3DE] bg-[#F8F7F4] hover:border-[#BEB9AF]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-[#141413]">
                            {svc.name}
                          </span>
                          <span className="text-[11px] font-mono text-[#6B6760] shrink-0">
                            {svc.price > 0 ? `+${activeCurrency} ${svc.price}` : svc.unitLabel}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-[#57544E] line-clamp-2">
                          {svc.description}
                        </p>
                      </button>
                    );
                  })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Printing Type */}
              <div className="sm:col-span-2">
                <span className="block text-sm font-medium text-[#141413] mb-2">
                  Printing Colour Mode
                </span>
                <div className="grid grid-cols-3 gap-1 p-1 bg-[#EFECE6] rounded-lg">
                  {(
                    [
                      { id: 'bw', label: `Black & White (${activeCurrency} ${pricingConfig.bwPagePrice}/sheet)` },
                      { id: 'color', label: `Colour (${activeCurrency} ${pricingConfig.colorPagePrice}/sheet)` },
                      { id: 'mixed', label: 'Mixed Printing' },
                    ] as { id: PrintType; label: string }[]
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => handlePrintTypeChange(mode.id)}
                      className={`py-2 px-2.5 text-xs font-medium rounded-md transition-colors ${
                        printing.printType === mode.id
                          ? 'bg-white text-[#141413] shadow-xs'
                          : 'text-[#57544E] hover:text-[#141413]'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>

                {printing.printType === 'mixed' && (
                  <div className="mt-3 rounded-lg border border-[#E5E3DE] bg-white p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="bw-pages-split" className="block text-xs font-medium text-[#141413] mb-1">
                        Black &amp; White Pages (of {effectivePageCount})
                      </label>
                      <input
                        id="bw-pages-split"
                        type="number"
                        min={0}
                        max={effectivePageCount}
                        value={printing.bwPages}
                        onChange={(e) => handleMixedBwPagesChange(Number(e.target.value))}
                        className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3 py-2 text-sm font-mono text-[#141413] tabular-nums focus:border-[#141413] focus:outline-none"
                      />
                    </div>
                    <div>
                      <span className="block text-xs font-medium text-[#141413] mb-1">
                        Colour Pages (auto-calculated)
                      </span>
                      <div className="rounded-lg border border-[#E5E3DE] bg-[#F3F1EC] px-3 py-2 text-sm font-mono font-semibold text-[#141413] tabular-nums">
                        {Math.max(0, effectivePageCount - printing.bwPages)} pages
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Single-sided / Double-sided */}
              <div>
                <span className="block text-sm font-medium text-[#141413] mb-2">
                  Sidedness
                </span>
                <div className="grid grid-cols-2 gap-1 p-1 bg-[#EFECE6] rounded-lg">
                  {(
                    [
                      { id: 'single', label: 'Single-sided' },
                      { id: 'double', label: 'Double-sided' },
                    ] as { id: PrintSides; label: string }[]
                  ).map((side) => (
                    <button
                      key={side.id}
                      type="button"
                      onClick={() => setPrinting((p) => ({ ...p, sides: side.id }))}
                      className={`py-2 px-3 text-xs font-medium rounded-md transition-colors ${
                        printing.sides === side.id
                          ? 'bg-white text-[#141413] shadow-xs'
                          : 'text-[#57544E] hover:text-[#141413]'
                      }`}
                    >
                      {side.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-[#6B6760] font-mono tabular-nums">
                  {printing.sides === 'double'
                    ? '2 document pages per physical A4 sheet'
                    : '1 document page per physical A4 sheet'}
                </p>
              </div>

              {/* Paper Size */}
              <div>
                <span className="block text-sm font-medium text-[#141413] mb-2">
                  Paper Size
                </span>
                <div className="rounded-lg border border-[#D4D0C8] bg-[#F3F1EC] px-3.5 py-2.5 text-sm font-medium text-[#141413] flex items-center justify-between">
                  <span>A4 Paper Standard</span>
                  <span className="font-mono text-xs text-[#6B6760]">210 × 297 mm</span>
                </div>
              </div>

              {/* Number of Copies */}
              <div>
                <label htmlFor="copies-input" className="block text-sm font-medium text-[#141413] mb-2">
                  Number of Copies
                </label>
                <div className="inline-flex items-center rounded-lg border border-[#D4D0C8] bg-white">
                  <button
                    type="button"
                    onClick={() => handleCopiesChange(printing.copies - 1)}
                    aria-label="Decrease copies"
                    className="w-10 h-10 flex items-center justify-center text-[#141413] hover:bg-[#F3F1EC] rounded-l-lg"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <input
                    id="copies-input"
                    type="number"
                    min={1}
                    max={200}
                    value={printing.copies}
                    onChange={(e) => handleCopiesChange(Number(e.target.value))}
                    className="w-14 h-10 text-center font-mono text-sm font-semibold text-[#141413] tabular-nums border-x border-[#E5E3DE] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopiesChange(printing.copies + 1)}
                    aria-label="Increase copies"
                    className="w-10 h-10 flex items-center justify-center text-[#141413] hover:bg-[#F3F1EC] rounded-r-lg"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Brown Envelope Quantity */}
              <div>
                <label htmlFor="envelope-qty-input" className="block text-sm font-medium text-[#141413] mb-2">
                  Brown Envelope Quantity ({activeCurrency} {pricingConfig.brownEnvelopePrice} each)
                </label>
                <div className="inline-flex items-center rounded-lg border border-[#D4D0C8] bg-white">
                  <button
                    type="button"
                    onClick={() => handleEnvelopeQtyChange(printing.envelopeQuantity - 1)}
                    aria-label="Decrease brown envelopes"
                    className="w-10 h-10 flex items-center justify-center text-[#141413] hover:bg-[#F3F1EC] rounded-l-lg"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <input
                    id="envelope-qty-input"
                    type="number"
                    min={0}
                    max={200}
                    value={printing.envelopeQuantity}
                    onChange={(e) => handleEnvelopeQtyChange(Number(e.target.value))}
                    className="w-14 h-10 text-center font-mono text-sm font-semibold text-[#141413] tabular-nums border-x border-[#E5E3DE] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleEnvelopeQtyChange(printing.envelopeQuantity + 1)}
                    aria-label="Increase brown envelopes"
                    className="w-10 h-10 flex items-center justify-center text-[#141413] hover:bg-[#F3F1EC] rounded-r-lg"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Stapling or Binding */}
            <div className="mt-6">
              <span className="block text-sm font-medium text-[#141413] mb-2">
                Stapling or Binding ({pricingConfig.bindingPrice > 0 ? `+${activeCurrency} ${pricingConfig.bindingPrice}/copy` : 'Subject to availability'})
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {FINISHING_OPTIONS.map((option) => {
                  const selected = printing.finishing === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() =>
                        setPrinting((p) => ({ ...p, finishing: option.id as FinishingType }))
                      }
                      className={`text-left rounded-xl border p-4 transition-colors ${
                        selected
                          ? 'border-[#141413] bg-white shadow-xs'
                          : 'border-[#E5E3DE] bg-[#F8F7F4] hover:border-[#BEB9AF] hover:bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-sm font-semibold text-[#141413]">
                          {option.label}
                        </span>
                        <span
                          className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                            selected ? 'border-[#C8232C] bg-[#C8232C]' : 'border-[#BDB8AE]'
                          }`}
                        >
                          {selected && <Check className="w-2.5 h-2.5 text-white" />}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[#57544E]">{option.shortDesc}</p>
                      <p className="mt-2 text-[11px] font-mono text-[#6B6760]">
                        {option.availabilityNote}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5">
              <label htmlFor="print-notes" className="block text-sm font-medium text-[#141413] mb-1.5">
                Printing Instructions (Optional)
              </label>
              <input
                id="print-notes"
                type="text"
                value={printing.notes}
                onChange={(e) => setPrinting((p) => ({ ...p, notes: e.target.value }))}
                placeholder="e.g., Print cover page in colour, rest B&W"
                className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm text-[#141413] placeholder:text-[#8A857C] focus:border-[#141413] focus:outline-none"
              />
            </div>
          </div>

          {/* 04. Campus Delivery or Pickup */}
          <div id="delivery-section" className="pb-10 border-b border-[#E5E3DE]">
            <h3 className="font-display text-xl font-semibold text-[#141413] mb-2">
              04. Delivery or Collection Preference
            </h3>
            <p className="text-sm text-[#57544E] mb-5">
              Choose campus delivery{pricingConfig.deliveryFee > 0 ? ` (${activeCurrency} ${pricingConfig.deliveryFee})` : ''} or free collection at the DEE PRINTS shop.
            </p>

            <div className="grid grid-cols-2 gap-1 p-1 bg-[#EFECE6] rounded-lg mb-5">
              <button
                type="button"
                onClick={() => setDelivery((p) => ({ ...p, method: 'campus_delivery' }))}
                className={`py-2.5 px-4 text-sm font-medium rounded-md transition-colors ${
                  delivery.method === 'campus_delivery'
                    ? 'bg-white text-[#141413] shadow-xs'
                    : 'text-[#57544E] hover:text-[#141413]'
                }`}
              >
                Campus Delivery
              </button>
              <button
                type="button"
                onClick={() => setDelivery((p) => ({ ...p, method: 'shop_pickup' }))}
                className={`py-2.5 px-4 text-sm font-medium rounded-md transition-colors ${
                  delivery.method === 'shop_pickup'
                    ? 'bg-white text-[#141413] shadow-xs'
                    : 'text-[#57544E] hover:text-[#141413]'
                }`}
              >
                Print Shop Collection
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {delivery.method === 'campus_delivery' && (
                <div>
                  <label htmlFor="campus-zone" className="block text-sm font-medium text-[#141413] mb-1.5">
                    Delivery Location
                  </label>
                  <select
                    id="campus-zone"
                    value={delivery.location}
                    onChange={(e) => setDelivery((p) => ({ ...p, location: e.target.value }))}
                    className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm text-[#141413] focus:border-[#141413] focus:outline-none"
                  >
                    {CAMPUS_DROP_ZONES.map((zone) => (
                      <option key={zone} value={zone}>
                        {zone}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className={delivery.method === 'shop_pickup' ? 'sm:col-span-2' : ''}>
                <label htmlFor="time-window" className="block text-sm font-medium text-[#141413] mb-1.5">
                  Preferred Time Window
                </label>
                <select
                  id="time-window"
                  value={delivery.timeWindow}
                  onChange={(e) => setDelivery((p) => ({ ...p, timeWindow: e.target.value }))}
                  className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm text-[#141413] focus:border-[#141413] focus:outline-none"
                >
                  {DELIVERY_TIME_WINDOWS.map((win) => (
                    <option key={win} value={win}>
                      {win}
                    </option>
                  ))}
                </select>
              </div>

              {delivery.method === 'campus_delivery' &&
                delivery.location === 'Hostel / Off-Campus Address' && (
                  <div className="sm:col-span-2">
                    <label htmlFor="off-campus" className="block text-sm font-medium text-[#141413] mb-1.5">
                      Hostel / Street Address
                    </label>
                    <input
                      id="off-campus"
                      type="text"
                      value={customOffCampusAddress}
                      onChange={(e) => setCustomOffCampusAddress(e.target.value)}
                      placeholder="Enter street address or hostel block"
                      className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm text-[#141413] placeholder:text-[#8A857C] focus:border-[#141413] focus:outline-none"
                    />
                  </div>
                )}

              <div className="sm:col-span-2">
                <label htmlFor="delivery-instructions" className="block text-sm font-medium text-[#141413] mb-1.5">
                  Delivery Instructions (Optional)
                </label>
                <input
                  id="delivery-instructions"
                  type="text"
                  value={delivery.instructions}
                  onChange={(e) => setDelivery((p) => ({ ...p, instructions: e.target.value }))}
                  placeholder="e.g., Call 5 minutes before arriving"
                  className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm text-[#141413] placeholder:text-[#8A857C] focus:border-[#141413] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* 05. Payment Options */}
          <div>
            <h3 className="font-display text-xl font-semibold text-[#141413] mb-2">
              05. Payment Options (For Direct Web Submission)
            </h3>
            <p className="text-sm text-[#57544E] mb-5">
              Select how you would like to pay for your calculated total of{' '}
              <span className="font-mono font-semibold text-[#141413] tabular-nums">
                {livePricing.currency} {livePricing.total.toLocaleString()}
              </span>
              .
            </p>

            <div className="space-y-3">
              {PAYMENT_OPTIONS.map((option) => {
                const selected = selectedPayment === option.id;
                const adminAccountDetails =
                  option.id === 'orange_money'
                    ? studioSettings.orangeMoneyDetails
                    : option.id === 'afri_money'
                      ? studioSettings.afriMoneyDetails
                      : '';
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setSelectedPayment(option.id)}
                    className={`w-full text-left rounded-xl border p-4 transition-colors ${
                      selected
                        ? 'border-[#141413] bg-white shadow-xs'
                        : 'border-[#E5E3DE] bg-[#F8F7F4] hover:border-[#BEB9AF] hover:bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-sm font-semibold text-[#141413]">
                        {option.label}
                      </span>
                      <span
                        className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                          selected ? 'border-[#C8232C] bg-[#C8232C]' : 'border-[#BDB8AE]'
                        }`}
                      >
                        {selected && <Check className="w-2.5 h-2.5 text-white" />}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[#57544E]">{option.description}</p>
                    {selected && adminAccountDetails && (
                      <div className="mt-3 rounded-lg border border-[#E5E3DE] bg-[#FAF9F7] p-3 text-xs text-[#141413]">
                        <p className="font-mono text-[11px] uppercase text-[#6B6760]">
                          Official Payment Instructions
                        </p>
                        <p className="mt-1 font-medium">{adminAccountDetails}</p>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {(selectedPayment === 'orange_money' || selectedPayment === 'afri_money') && (
              <div className="mt-4">
                <label htmlFor="payment-ref" className="block text-sm font-medium text-[#141413] mb-1.5">
                  Transaction Reference / Sender Number (Optional)
                </label>
                <input
                  id="payment-ref"
                  type="text"
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  placeholder="Enter transaction ID or mobile money number used"
                  className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm font-mono text-[#141413] placeholder:font-sans placeholder:text-[#8A857C] focus:border-[#141413] focus:outline-none"
                />
              </div>
            )}
          </div>
        </div>

        {/* Right Sticky Column */}
        <aside className="lg:col-span-5 lg:sticky lg:top-24 space-y-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-lg font-semibold text-[#141413]">
                Brown Envelope Label Preview
              </h3>
              <span className="text-xs font-mono text-[#6B6760] tabular-nums">Auto-Synced</span>
            </div>
            <EnvelopePreview
              customer={customerForPreview}
              envelopeQuantity={printing.envelopeQuantity}
              copies={printing.copies}
              finishingLabel={selectedFinishingMeta.label}
              envelopeNote={envelopeNote}
            />
          </div>

          <div className="rounded-xl border border-[#D4D0C8] bg-white p-6 space-y-5">
            <div>
              <p className="text-xs font-mono text-[#6B6760] uppercase tracking-wider">
                Configurable Price Breakdown
              </p>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-2 text-[#57544E]">
                  <span>Documents &amp; Pages</span>
                  <span className="font-mono text-[#141413] tabular-nums">
                    {uploadedFiles.length > 0
                      ? `${uploadedFiles.length} file(s) · ${totalDetectedPages}p`
                      : 'Upload file(s)'}
                  </span>
                </div>
                <div className="flex justify-between gap-2 text-[#57544E]">
                  <span>Printing Cost</span>
                  <span className="font-mono text-[#141413] tabular-nums">
                    {livePricing.currency}{' '}
                    {(livePricing.printingCost ?? (livePricing.bwCost + livePricing.colorCost)).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between gap-2 text-[#57544E]">
                  <span>Packaging (Envelopes + Binding)</span>
                  <span className="font-mono text-[#141413] tabular-nums">
                    {livePricing.currency}{' '}
                    {(livePricing.packagingCost ?? livePricing.envelopeCost).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between gap-2 text-[#57544E]">
                  <span>Additional Services</span>
                  <span className="font-mono text-[#141413] tabular-nums">
                    {livePricing.currency}{' '}
                    {(livePricing.additionalServicesCost ?? 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between gap-2 text-[#57544E]">
                  <span>Delivery Fee</span>
                  <span className="font-mono text-[#141413] tabular-nums">
                    {livePricing.currency} {(livePricing.deliveryFee ?? 0).toLocaleString()}
                  </span>
                </div>
                <div className="pt-3 border-t border-[#E5E3DE] flex items-baseline justify-between gap-2">
                  <span className="font-display font-semibold text-[#141413]">Total Order Cost</span>
                  <span className="font-mono text-2xl font-bold text-[#141413] tabular-nums">
                    {livePricing.currency} {livePricing.total.toLocaleString()}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-[#6B6760]">
                Rates: {livePricing.currency} {pricingConfig.bwPagePrice}/B&amp;W ·{' '}
                {livePricing.currency} {pricingConfig.colorPagePrice}/Colour ·{' '}
                {livePricing.currency} {pricingConfig.brownEnvelopePrice}/envelope (Admin-configured).
              </p>
            </div>

            {submitError && (
              <div
                role="alert"
                className="rounded-lg border border-[#C8232C]/30 bg-[#C8232C]/5 px-3.5 py-2.5 text-sm text-[#C8232C] font-medium"
              >
                {submitError}
              </div>
            )}

            <div className="space-y-2.5">
              <button
                type="submit"
                disabled={submitting || startingWhatsapp || parsingFiles}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 text-sm font-semibold text-white bg-[#C8232C] rounded-lg hover:bg-[#AE1D25] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {submitting || startingWhatsapp ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving Order &amp; Opening WhatsApp...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    ORDER &amp; GO TO WHATSAPP ({livePricing.currency} {livePricing.total.toLocaleString()})
                  </>
                )}
              </button>
              <p className="text-[11px] text-center text-[#6B6760]">
                Saves your uploaded files &amp; opens our WhatsApp line directly with your Order Reference.
              </p>
            </div>
          </div>
        </aside>
      </form>
    </section>
  );
};
