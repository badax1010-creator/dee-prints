import React, { Component, ErrorInfo, ReactNode, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  History,
  Loader2,
  Lock,
  LogOut,
  Mail,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sliders,
  Trash2,
} from 'lucide-react';
import {
  ADMIN_EMAIL,
  DEFAULT_STUDIO_SETTINGS,
  fetchAdminPrivateSettings,
  fetchPricingConfig,
  fetchServicesCatalog,
  fetchStudioSettings,
  isAuthorizedAdminUser,
  saveAdminPrivateSettingsInFirestore,
  savePricingConfigInFirestore,
  saveServicesCatalogInFirestore,
  saveStudioSettingsInFirestore,
  signInAdminWithGoogle,
  signOutAdmin,
  subscribeToAuth,
  subscribeToOrderAudit,
  subscribeToOrders,
  syncBotOrderToFirestore,
  updateOrderAdditionalChargesInFirestore,
  updateOrderEmailNotificationInFirestore,
  updateOrderPaymentStatusInFirestore,
  updateOrderQuotationInFirestore,
  updateOrderStatusInFirestore,
  updateOrderWhatsappNotificationInFirestore,
} from '../firebase';
import {
  DEFAULT_PRICING_CONFIG,
  DEFAULT_PRINTING_SERVICES,
  EmailNotificationMeta,
  FINISHING_OPTIONS,
  normalizeOrderStatus,
  OrderAuditEntry,
  OrderStatus,
  PAYMENT_OPTIONS,
  PaymentStatus,
  PricingConfig,
  PrintingServiceItem,
  PrintOrderRecord,
  StudioSettings,
  WhatsAppNotificationMeta,
} from '../types';
import { buildEnvelopeLabelHtml } from '../envelopeHtml';
import { EnvelopePreview } from './EnvelopePreview';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AdminErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('AdminDashboard error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="max-w-xl mx-auto my-16 rounded-xl border border-[#C8232C]/30 bg-white p-8">
          <h2 className="font-display text-xl font-bold text-[#141413]">
            Dashboard Data Error
          </h2>
          <p className="mt-2 text-sm text-[#57544E]">
            Unable to load or update administrator data. Please verify your administrator Google sign-in and Firestore permissions.
          </p>
          <p className="mt-2 text-xs font-mono text-[#6B6760] break-all">
            {this.state.message}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, message: '' })}
            className="mt-5 px-4 py-2 text-sm font-medium text-white bg-[#141413] rounded-lg hover:bg-[#2C2A27]"
          >
            Reload View
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const ALL_STATUSES: OrderStatus[] = [
  'ORDER RECEIVED',
  'AWAITING PAYMENT',
  'PAYMENT CONFIRMED',
  'PRINTING IN PROGRESS',
  'READY FOR COLLECTION',
  'OUT FOR DELIVERY',
  'SUCCESSFULLY DELIVERED',
  'CANCELLED',
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function authenticatedDownload(url: string, fallbackFilename: string, user: User) {
  const token = await user.getIdToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fallbackFilename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
}

const AdminDashboardContent: React.FC<{ user: User }> = ({ user }) => {
  const [activeTab, setActiveTab] = useState<'orders' | 'pricing_services' | 'settings'>('orders');
  const [orders, setOrders] = useState<PrintOrderRecord[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [syncingBotOrders, setSyncingBotOrders] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [paymentFilter, setPaymentFilter] = useState<string>('ALL');

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [auditEntries, setAuditEntries] = useState<OrderAuditEntry[]>([]);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null,
  );

  // Additional charges & quotation inputs
  const [extraChargeInput, setExtraChargeInput] = useState('0');
  const [extraChargeNote, setExtraChargeNote] = useState('');
  const [quoteSummaryInput, setQuoteSummaryInput] = useState('');

  // Pricing Engine & Services Catalog state
  const [pricingConfig, setPricingConfig] = useState<PricingConfig>(DEFAULT_PRICING_CONFIG);
  const [services, setServices] = useState<PrintingServiceItem[]>(DEFAULT_PRINTING_SERVICES);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServiceCategory, setNewServiceCategory] =
    useState<PrintingServiceItem['category']>('document');
  const [newServicePrice, setNewServicePrice] = useState('0');
  const [newServiceUnit, setNewServiceUnit] = useState('per order');
  const [newServiceDesc, setNewServiceDesc] = useState('');
  const [savingPricingServices, setSavingPricingServices] = useState(false);

  // Admin Settings state
  const [currency, setCurrency] = useState(DEFAULT_STUDIO_SETTINGS.currency);
  const [orangeMoneyDetails, setOrangeMoneyDetails] = useState(
    DEFAULT_STUDIO_SETTINGS.orangeMoneyDetails,
  );
  const [afriMoneyDetails, setAfriMoneyDetails] = useState(
    DEFAULT_STUDIO_SETTINGS.afriMoneyDetails,
  );
  const [adminNumbersText, setAdminNumbersText] = useState('');
  const [adminNotificationEmail, setAdminNotificationEmail] = useState(ADMIN_EMAIL);
  const [templateName, setTemplateName] = useState('');
  const [templateLang, setTemplateLang] = useState('en_US');
  const [whatsappApiConfigured, setWhatsappApiConfigured] = useState<boolean | null>(null);
  const [emailApiConfigured, setEmailApiConfigured] = useState<boolean | null>(null);
  const [botSecretConfigured, setBotSecretConfigured] = useState<boolean | null>(null);
  const [webhookConfigured, setWebhookConfigured] = useState<boolean | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const syncFromBackendVault = async () => {
    setSyncingBotOrders(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/orders', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { orders: PrintOrderRecord[] };
        for (const srvOrder of data.orders.slice(0, 40)) {
          await syncBotOrderToFirestore(srvOrder);
        }
      }
    } catch (err) {
      console.warn('Could not sync backend vault orders:', err);
    } finally {
      setSyncingBotOrders(false);
    }
  };

  useEffect(() => {
    setLoadingOrders(true);
    setOrdersError(null);
    void syncFromBackendVault();
    const unsub = subscribeToOrders(
      (list) => {
        setOrders(list);
        setLoadingOrders(false);
        setSelectedOrderId((prev) => prev || (list[0]?.orderId ?? null));
      },
      (err) => {
        setOrdersError(err.message);
        setLoadingOrders(false);
      },
    );
    return () => unsub();
  }, [user]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [studio, priv, pricingCfg, svcs] = await Promise.all([
          fetchStudioSettings(),
          fetchAdminPrivateSettings().catch(() => ({
            adminWhatsappNumbers: [],
            whatsappTemplateName: '',
            whatsappTemplateLanguage: 'en_US',
            adminNotificationEmail: ADMIN_EMAIL,
          })),
          fetchPricingConfig(),
          fetchServicesCatalog(),
        ]);
        setCurrency(studio.currency);
        setOrangeMoneyDetails(studio.orangeMoneyDetails);
        setAfriMoneyDetails(studio.afriMoneyDetails);
        setPricingConfig(pricingCfg);
        setServices(svcs);

        const token = await user.getIdToken();
        const [serverRes, srvPricingRes, srvSvcRes] = await Promise.all([
          fetch('/api/admin/settings', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/admin/pricing', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/admin/services', { headers: { Authorization: `Bearer ${token}` } }),
        ]);

        if (serverRes.ok) {
          const srv = (await serverRes.json()) as {
            adminWhatsappNumbers: string[];
            whatsappTemplateName: string;
            whatsappTemplateLanguage: string;
            adminNotificationEmail?: string;
            whatsappApiConfigured: boolean;
            emailApiConfigured: boolean;
            botSecretConfigured?: boolean;
            webhookVerifyTokenConfigured?: boolean;
          };
          const mergedNumbers =
            priv.adminWhatsappNumbers.length > 0
              ? priv.adminWhatsappNumbers
              : srv.adminWhatsappNumbers;
          setAdminNumbersText(mergedNumbers.join(', '));
          setAdminNotificationEmail(
            priv.adminNotificationEmail || srv.adminNotificationEmail || ADMIN_EMAIL,
          );
          setTemplateName(priv.whatsappTemplateName || srv.whatsappTemplateName || '');
          setTemplateLang(priv.whatsappTemplateLanguage || srv.whatsappTemplateLanguage || 'en_US');
          setWhatsappApiConfigured(srv.whatsappApiConfigured);
          setEmailApiConfigured(srv.emailApiConfigured);
          setBotSecretConfigured(Boolean(srv.botSecretConfigured));
          setWebhookConfigured(Boolean(srv.webhookVerifyTokenConfigured));
        } else {
          setAdminNumbersText(priv.adminWhatsappNumbers.join(', '));
          setAdminNotificationEmail(priv.adminNotificationEmail || ADMIN_EMAIL);
          setTemplateName(priv.whatsappTemplateName);
          setTemplateLang(priv.whatsappTemplateLanguage);
        }

        if (srvPricingRes.ok) {
          const pJson = (await srvPricingRes.json()) as PricingConfig;
          setPricingConfig(pJson);
        }
        if (srvSvcRes.ok) {
          const sJson = (await srvSvcRes.json()) as { services: PrintingServiceItem[] };
          if (Array.isArray(sJson.services) && sJson.services.length > 0) {
            setServices(sJson.services);
          }
        }
      } catch (err) {
        console.warn('Error loading admin settings:', err);
      }
    };
    void loadSettings();
  }, [user]);

  const selectedOrder = useMemo(
    () => orders.find((o) => o.orderId === selectedOrderId) || null,
    [orders, selectedOrderId],
  );

  useEffect(() => {
    if (!selectedOrder) {
      setAuditEntries([]);
      return;
    }
    setExtraChargeInput(String(selectedOrder.pricing?.additionalCharges ?? 0));
    setExtraChargeNote('');
    setQuoteSummaryInput(selectedOrder.quotation?.summary || '');
    const unsub = subscribeToOrderAudit(selectedOrder.orderId, (entries) => {
      setAuditEntries(entries);
    });
    return () => unsub();
  }, [selectedOrder?.orderId]);

  const kpis = useMemo(() => {
    const now = new Date();
    const todayY = now.getFullYear();
    const todayM = now.getMonth();
    const todayD = now.getDate();

    let totalRevenue = 0;
    let dailyRevenue = 0;
    let monthlyRevenue = 0;

    for (const o of orders) {
      if (o.status === 'CANCELLED') continue;
      const amount = Number(o.pricing?.total || 0);
      if (o.payment?.status === 'CONFIRMED') {
        totalRevenue += amount;
        const dt = new Date(o.createdAt);
        if (dt.getFullYear() === todayY && dt.getMonth() === todayM) {
          monthlyRevenue += amount;
          if (dt.getDate() === todayD) {
            dailyRevenue += amount;
          }
        }
      }
    }

    const norm = (o: PrintOrderRecord) => normalizeOrderStatus(o.status);

    return {
      total: orders.length,
      newOrders: orders.filter((o) => norm(o) === 'ORDER RECEIVED').length,
      pendingOrders: orders.filter((o) => ['ORDER RECEIVED', 'AWAITING PAYMENT'].includes(norm(o))).length,
      awaitingPayment: orders.filter((o) => norm(o) === 'AWAITING PAYMENT' || o.payment?.status === 'PENDING').length,
      paidOrders: orders.filter((o) => o.payment?.status === 'CONFIRMED' || norm(o) === 'PAYMENT CONFIRMED').length,
      processing: orders.filter((o) => norm(o) === 'PRINTING IN PROGRESS').length,
      completed: orders.filter((o) => ['READY FOR COLLECTION', 'OUT FOR DELIVERY'].includes(norm(o))).length,
      delivered: orders.filter((o) => norm(o) === 'SUCCESSFULLY DELIVERED').length,
      cancelled: orders.filter((o) => norm(o) === 'CANCELLED').length,
      totalRevenue,
      dailyRevenue,
      monthlyRevenue,
    };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter((o) => {
      const normalized = normalizeOrderStatus(o.status);
      if (statusFilter !== 'ALL' && normalized !== statusFilter) return false;
      if (paymentFilter !== 'ALL' && o.payment?.status !== paymentFilter) return false;
      if (!q) return true;
      return (
        o.orderId.toLowerCase().includes(q) ||
        o.customer.studentId.toLowerCase().includes(q) ||
        o.customer.fullName.toLowerCase().includes(q) ||
        o.customer.assignmentTitle.toLowerCase().includes(q) ||
        o.customer.whatsappPhone.toLowerCase().includes(q)
      );
    });
  }, [orders, searchQuery, statusFilter, paymentFilter]);

  const mirrorPatchToBackend = async (
    orderId: string,
    payload: {
      status?: OrderStatus;
      paymentStatus?: PaymentStatus;
      additionalCharges?: number;
      quotation?: PrintOrderRecord['quotation'];
    },
  ) => {
    try {
      const token = await user.getIdToken();
      await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch {
      // Non-fatal if server vault doesn't hold older order
    }
  };

  const handleStatusChange = async (order: PrintOrderRecord, nextStatus: OrderStatus) => {
    setActionBusy('status');
    setActionFeedback(null);
    try {
      await Promise.all([
        updateOrderStatusInFirestore(order, nextStatus, user.email || ADMIN_EMAIL),
        mirrorPatchToBackend(order.orderId, { status: nextStatus }),
      ]);
      setActionFeedback({ type: 'ok', text: `Order ${order.orderId} updated to ${nextStatus}.` });
    } catch (err) {
      setActionFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Status update failed.',
      });
    } finally {
      setActionBusy(null);
    }
  };

  const handlePaymentStatusChange = async (
    order: PrintOrderRecord,
    nextStatus: PaymentStatus,
  ) => {
    setActionBusy('payment');
    setActionFeedback(null);
    try {
      await Promise.all([
        updateOrderPaymentStatusInFirestore(order, nextStatus, user.email || ADMIN_EMAIL),
        mirrorPatchToBackend(order.orderId, { paymentStatus: nextStatus }),
      ]);
      if (nextStatus === 'CONFIRMED' && normalizeOrderStatus(order.status) === 'AWAITING PAYMENT') {
        await updateOrderStatusInFirestore(order, 'PAYMENT CONFIRMED', user.email || ADMIN_EMAIL);
        await mirrorPatchToBackend(order.orderId, { status: 'PAYMENT CONFIRMED' });
      }
      setActionFeedback({
        type: 'ok',
        text: `Payment for ${order.orderId} marked ${nextStatus}.`,
      });
    } catch (err) {
      setActionFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Payment verification update failed.',
      });
    } finally {
      setActionBusy(null);
    }
  };

  const handleSaveAdditionalCharges = async (order: PrintOrderRecord) => {
    setActionBusy('charges');
    setActionFeedback(null);
    try {
      const val = Math.max(0, Number(extraChargeInput) || 0);
      await Promise.all([
        updateOrderAdditionalChargesInFirestore(
          order,
          val,
          user.email || ADMIN_EMAIL,
          extraChargeNote.trim(),
        ),
        mirrorPatchToBackend(order.orderId, { additionalCharges: val }),
      ]);
      setActionFeedback({
        type: 'ok',
        text: `Approved additional charges updated for ${order.orderId}.`,
      });
    } catch (err) {
      setActionFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to update charges.',
      });
    } finally {
      setActionBusy(null);
    }
  };

  const handleSendAdminQuotation = async (order: PrintOrderRecord) => {
    setActionBusy('quote');
    setActionFeedback(null);
    try {
      const extraVal = Math.max(0, Number(extraChargeInput) || 0);
      const baseSubtotal =
        (order.pricing.printingCost ?? (order.pricing.bwCost + order.pricing.colorCost)) +
        (order.pricing.packagingCost ?? order.pricing.envelopeCost) +
        (order.pricing.deliveryFee ?? 0) +
        (order.pricing.additionalServicesCost ?? 0);
      const nextTotal = Number((baseSubtotal + extraVal).toFixed(2));
      const quotationMeta = {
        summary:
          quoteSummaryInput.trim() ||
          `Total quotation for ${order.orderId}: ${order.pricing.currency} ${nextTotal.toLocaleString()}`,
        quotedBy: user.email || ADMIN_EMAIL,
        quotedAt: new Date().toISOString(),
        totalAmount: nextTotal,
        currency: order.pricing.currency,
      };
      await Promise.all([
        updateOrderQuotationInFirestore(order, quotationMeta, extraVal, nextTotal, user.email || ADMIN_EMAIL),
        mirrorPatchToBackend(order.orderId, {
          additionalCharges: extraVal,
          quotation: quotationMeta,
          status: 'AWAITING PAYMENT',
        }),
      ]);
      if (normalizeOrderStatus(order.status) === 'ORDER RECEIVED') {
        await updateOrderStatusInFirestore(order, 'AWAITING PAYMENT', user.email || ADMIN_EMAIL);
      }
      setActionFeedback({
        type: 'ok',
        text: `Quotation saved for ${order.orderId} (${quotationMeta.currency} ${quotationMeta.totalAmount.toLocaleString()}).`,
      });
    } catch (err) {
      setActionFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Could not save quotation.',
      });
    } finally {
      setActionBusy(null);
    }
  };

  const handleDownloadDocument = async (
    order: PrintOrderRecord,
    fileId: string,
    filename: string,
  ) => {
    setActionBusy(`doc_${fileId}`);
    setActionFeedback(null);
    try {
      await authenticatedDownload(
        `/api/admin/orders/${encodeURIComponent(order.orderId)}/document?fileId=${encodeURIComponent(fileId)}`,
        filename,
        user,
      );
    } catch (err) {
      setActionFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Could not download document.',
      });
    } finally {
      setActionBusy(null);
    }
  };

  const handleDownloadEnvelopeLabel = async (order: PrintOrderRecord) => {
    setActionBusy('label');
    setActionFeedback(null);
    try {
      await authenticatedDownload(
        `/api/admin/orders/${encodeURIComponent(order.orderId)}/label`,
        `DEE-PRINTS-Label-${order.orderId}.html`,
        user,
      );
    } catch {
      const finishingLabel =
        FINISHING_OPTIONS.find((f) => f.id === order.printing.finishing)?.label ||
        order.printing.finishing;
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
    } finally {
      setActionBusy(null);
    }
  };

  const handlePrintEnvelopeLabel = () => {
    window.print();
  };

  const handleRetryWhatsApp = async (order: PrintOrderRecord) => {
    setActionBusy('retry');
    setActionFeedback(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/admin/notifications/retry/${encodeURIComponent(order.orderId)}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Retry request failed.');
      }
      const nextMeta = (await res.json()) as WhatsAppNotificationMeta;
      await updateOrderWhatsappNotificationInFirestore(
        order.orderId,
        nextMeta,
        user.email || ADMIN_EMAIL,
      );
      setActionFeedback({
        type: nextMeta.status === 'SENT' ? 'ok' : 'err',
        text:
          nextMeta.status === 'SENT'
            ? `WhatsApp notification sent for ${order.orderId}.`
            : `Retry attempted but failed: ${nextMeta.lastError}`,
      });
    } catch (err) {
      setActionFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Could not retry WhatsApp notification.',
      });
    } finally {
      setActionBusy(null);
    }
  };

  const handleRetryEmail = async (order: PrintOrderRecord) => {
    setActionBusy('email');
    setActionFeedback(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/admin/email/retry/${encodeURIComponent(order.orderId)}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Email retry request failed.');
      }
      const nextMeta = (await res.json()) as EmailNotificationMeta;
      await updateOrderEmailNotificationInFirestore(
        order.orderId,
        nextMeta,
        user.email || ADMIN_EMAIL,
      );
      setActionFeedback({
        type: nextMeta.status === 'SENT' ? 'ok' : 'err',
        text:
          nextMeta.status === 'SENT'
            ? `Order email with attachments and envelope label sent for ${order.orderId}.`
            : `Email retry attempted but failed: ${nextMeta.lastError}`,
      });
    } catch (err) {
      setActionFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Could not retry email notification.',
      });
    } finally {
      setActionBusy(null);
    }
  };

  const handleSavePricingAndServices = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPricingServices(true);
    setActionFeedback(null);
    try {
      const cleanPricing: Omit<PricingConfig, 'updatedAt'> = {
        currency: (pricingConfig.currency || currency || 'SLE').trim().toUpperCase().slice(0, 12),
        bwPagePrice: Math.max(0, Number(pricingConfig.bwPagePrice) || 0),
        colorPagePrice: Math.max(0, Number(pricingConfig.colorPagePrice) || 0),
        singleSidedPrice: Math.max(0, Number(pricingConfig.singleSidedPrice) || 0),
        doubleSidedPrice: Math.max(0, Number(pricingConfig.doubleSidedPrice) || 0),
        brownEnvelopePrice: Math.max(0, Number(pricingConfig.brownEnvelopePrice) || 0),
        bindingPrice: Math.max(0, Number(pricingConfig.bindingPrice) || 0),
        deliveryFee: Math.max(0, Number(pricingConfig.deliveryFee) || 0),
        additionalServiceCharge: Math.max(0, Number(pricingConfig.additionalServiceCharge) || 0),
      };

      const token = await user.getIdToken();
      await Promise.all([
        savePricingConfigInFirestore(cleanPricing),
        saveServicesCatalogInFirestore(services),
        fetch('/api/admin/pricing', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(cleanPricing),
        }),
        fetch('/api/admin/services', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ services }),
        }),
      ]);

      setActionFeedback({
        type: 'ok',
        text: 'Dynamic Pricing Engine & Printing Services Catalog saved to Firestore and WhatsApp Bot backend.',
      });
    } catch (err) {
      setActionFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Could not save pricing & services.',
      });
    } finally {
      setSavingPricingServices(false);
    }
  };

  const handleAddService = () => {
    if (!newServiceName.trim()) return;
    const id = newServiceName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .slice(0, 40) + `_${Date.now().toString(36).slice(-3)}`;
    setServices((prev) => [
      ...prev,
      {
        id,
        name: newServiceName.trim(),
        category: newServiceCategory,
        description: newServiceDesc.trim() || 'Custom studio printing service.',
        price: Math.max(0, Number(newServicePrice) || 0),
        unitLabel: newServiceUnit.trim() || 'per order',
        enabled: true,
      },
    ]);
    setNewServiceName('');
    setNewServicePrice('0');
    setNewServiceDesc('');
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setActionFeedback(null);

    const parsedNumbers = adminNumbersText
      .split(/[\n,]+/)
      .map((s) => s.replace(/\D/g, ''))
      .filter((s) => s.length >= 7)
      .slice(0, 5);

    if (parsedNumbers.length === 0) {
      setActionFeedback({
        type: 'err',
        text: 'Enter at least one valid administrator WhatsApp number.',
      });
      setSavingSettings(false);
      return;
    }

    const cleanEmail = adminNotificationEmail.trim() || ADMIN_EMAIL;
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      setActionFeedback({
        type: 'err',
        text: 'Enter a valid administrator notification email address.',
      });
      setSavingSettings(false);
      return;
    }

    try {
      const studioPayload: Omit<StudioSettings, 'updatedAt'> = {
        currency: currency.trim().toUpperCase().slice(0, 12) || 'SLE',
        orangeMoneyDetails: orangeMoneyDetails.trim(),
        afriMoneyDetails: afriMoneyDetails.trim(),
      };
      const privatePayload = {
        adminWhatsappNumbers: parsedNumbers,
        whatsappTemplateName: templateName.trim(),
        whatsappTemplateLanguage: templateLang.trim() || 'en_US',
        adminNotificationEmail: cleanEmail,
      };

      await Promise.all([
        saveStudioSettingsInFirestore(studioPayload),
        saveAdminPrivateSettingsInFirestore(privatePayload),
      ]);

      const token = await user.getIdToken();
      const srvRes = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(privatePayload),
      });
      if (!srvRes.ok) {
        const err = await srvRes.json().catch(() => ({}));
        throw new Error(err.error || 'Could not sync notification settings to backend.');
      }

      setActionFeedback({
        type: 'ok',
        text: 'Administrator studio, Email & WhatsApp settings saved.',
      });
    } catch (err) {
      setActionFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save administrator settings.',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const activeCur = pricingConfig.currency || currency || 'SLE';

  return (
    <main className="max-w-[1240px] mx-auto px-6 py-10">
      {/* Header Bar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-[#E5E3DE]">
        <div>
          <p className="text-xs font-mono text-[#6B6760] uppercase tracking-wider">
            DEE PRINTS · Operations Control
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#141413] mt-1">
            Administrator Dashboard
          </h1>
          <p className="text-xs text-[#57544E] mt-1 font-mono">
            Signed in as {user.email}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-[#D4D0C8] bg-[#EFECE6] p-1">
            <button
              type="button"
              onClick={() => setActiveTab('orders')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'orders'
                  ? 'bg-white text-[#141413] shadow-xs'
                  : 'text-[#57544E] hover:text-[#141413]'
              }`}
            >
              Orders Queue
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('pricing_services')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'pricing_services'
                  ? 'bg-white text-[#141413] shadow-xs'
                  : 'text-[#57544E] hover:text-[#141413]'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              Services &amp; Pricing
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'settings'
                  ? 'bg-white text-[#141413] shadow-xs'
                  : 'text-[#57544E] hover:text-[#141413]'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              Settings
            </button>
          </div>

          <button
            type="button"
            disabled={syncingBotOrders}
            onClick={() => void syncFromBackendVault()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-[#D4D0C8] bg-white text-[#141413] rounded-lg hover:bg-[#F3F1EC] disabled:opacity-60 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingBotOrders ? 'animate-spin' : ''}`} />
            Sync Bot Orders
          </button>

          <button
            type="button"
            onClick={() => void signOutAdmin()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-[#D4D0C8] bg-white text-[#141413] rounded-lg hover:bg-[#F3F1EC] transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </div>

      {actionFeedback && (
        <div
          className={`no-print mt-5 rounded-lg border px-4 py-3 text-sm font-medium ${
            actionFeedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-[#C8232C]/30 bg-[#C8232C]/5 text-[#C8232C]'
          }`}
        >
          {actionFeedback.text}
        </div>
      )}

      {activeTab === 'pricing_services' ? (
        <section className="no-print mt-8 space-y-8">
          <form onSubmit={handleSavePricingAndServices} className="space-y-8">
            {/* Configurable Pricing Engine */}
            <div className="rounded-xl border border-[#E5E3DE] bg-white p-6 space-y-5">
              <div>
                <h2 className="font-display text-lg font-semibold text-[#141413]">
                  Configurable Pricing Engine
                </h2>
                <p className="text-xs text-[#57544E] mt-1">
                  Formula: Printing cost + Packaging cost + Additional services + Delivery fee = Total order cost. Shared live with the website and WhatsApp Bot.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#141413] mb-1">
                    Currency Code
                  </label>
                  <input
                    type="text"
                    value={pricingConfig.currency}
                    onChange={(e) =>
                      setPricingConfig((p) => ({ ...p, currency: e.target.value.toUpperCase() }))
                    }
                    className="w-full rounded-lg border border-[#D4D0C8] px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#141413] mb-1">
                    B&amp;W Page Price ({activeCur})
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={pricingConfig.bwPagePrice}
                    onChange={(e) =>
                      setPricingConfig((p) => ({ ...p, bwPagePrice: Number(e.target.value) }))
                    }
                    className="w-full rounded-lg border border-[#D4D0C8] px-3 py-2 text-sm font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#141413] mb-1">
                    Colour Page Price ({activeCur})
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={pricingConfig.colorPagePrice}
                    onChange={(e) =>
                      setPricingConfig((p) => ({ ...p, colorPagePrice: Number(e.target.value) }))
                    }
                    className="w-full rounded-lg border border-[#D4D0C8] px-3 py-2 text-sm font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#141413] mb-1">
                    Single-Sided Modifier / Sheet ({activeCur})
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={pricingConfig.singleSidedPrice}
                    onChange={(e) =>
                      setPricingConfig((p) => ({ ...p, singleSidedPrice: Number(e.target.value) }))
                    }
                    className="w-full rounded-lg border border-[#D4D0C8] px-3 py-2 text-sm font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#141413] mb-1">
                    Double-Sided Modifier / Sheet ({activeCur})
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={pricingConfig.doubleSidedPrice}
                    onChange={(e) =>
                      setPricingConfig((p) => ({ ...p, doubleSidedPrice: Number(e.target.value) }))
                    }
                    className="w-full rounded-lg border border-[#D4D0C8] px-3 py-2 text-sm font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#141413] mb-1">
                    Brown Envelope Price ({activeCur})
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={pricingConfig.brownEnvelopePrice}
                    onChange={(e) =>
                      setPricingConfig((p) => ({ ...p, brownEnvelopePrice: Number(e.target.value) }))
                    }
                    className="w-full rounded-lg border border-[#D4D0C8] px-3 py-2 text-sm font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#141413] mb-1">
                    Binding Price / Copy ({activeCur})
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={pricingConfig.bindingPrice}
                    onChange={(e) =>
                      setPricingConfig((p) => ({ ...p, bindingPrice: Number(e.target.value) }))
                    }
                    className="w-full rounded-lg border border-[#D4D0C8] px-3 py-2 text-sm font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#141413] mb-1">
                    Campus Delivery Fee ({activeCur})
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={pricingConfig.deliveryFee}
                    onChange={(e) =>
                      setPricingConfig((p) => ({ ...p, deliveryFee: Number(e.target.value) }))
                    }
                    className="w-full rounded-lg border border-[#D4D0C8] px-3 py-2 text-sm font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#141413] mb-1">
                    Additional Service Base Charge ({activeCur})
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={pricingConfig.additionalServiceCharge}
                    onChange={(e) =>
                      setPricingConfig((p) => ({
                        ...p,
                        additionalServiceCharge: Number(e.target.value),
                      }))
                    }
                    className="w-full rounded-lg border border-[#D4D0C8] px-3 py-2 text-sm font-mono tabular-nums"
                  />
                </div>
              </div>
            </div>

            {/* Printing Services Catalog CRUD */}
            <div className="rounded-xl border border-[#E5E3DE] bg-white p-6 space-y-5">
              <div>
                <h2 className="font-display text-lg font-semibold text-[#141413]">
                  Printing &amp; Document Services Catalog
                </h2>
                <p className="text-xs text-[#57544E] mt-1">
                  Add, remove, toggle, or adjust prices for services available to students and the WhatsApp Bot.
                </p>
              </div>

              <div className="space-y-2.5">
                {services.map((svc, idx) => (
                  <div
                    key={svc.id}
                    className="rounded-lg border border-[#E5E3DE] bg-[#FAF9F7] p-3.5 grid grid-cols-1 md:grid-cols-12 gap-3 items-center"
                  >
                    <div className="md:col-span-4">
                      <input
                        type="text"
                        value={svc.name}
                        onChange={(e) =>
                          setServices((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, name: e.target.value } : item,
                            ),
                          )
                        }
                        className="w-full rounded border border-[#D4D0C8] bg-white px-2.5 py-1.5 text-sm font-medium"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <select
                        value={svc.category}
                        onChange={(e) =>
                          setServices((prev) =>
                            prev.map((item, i) =>
                              i === idx
                                ? { ...item, category: e.target.value as PrintingServiceItem['category'] }
                                : item,
                            ),
                          )
                        }
                        className="w-full rounded border border-[#D4D0C8] bg-white px-2 py-1.5 text-xs"
                      >
                        <option value="printing">Printing</option>
                        <option value="finishing">Finishing</option>
                        <option value="document">Document</option>
                        <option value="delivery">Delivery</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <input
                        type="number"
                        min={0}
                        value={svc.price}
                        onChange={(e) =>
                          setServices((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, price: Math.max(0, Number(e.target.value) || 0) } : item,
                            ),
                          )
                        }
                        aria-label={`Price for ${svc.name}`}
                        className="w-full rounded border border-[#D4D0C8] bg-white px-2.5 py-1.5 text-xs font-mono tabular-nums"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <input
                        type="text"
                        value={svc.unitLabel}
                        onChange={(e) =>
                          setServices((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, unitLabel: e.target.value } : item,
                            ),
                          )
                        }
                        className="w-full rounded border border-[#D4D0C8] bg-white px-2.5 py-1.5 text-xs"
                      />
                    </div>
                    <div className="md:col-span-2 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setServices((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, enabled: !item.enabled } : item,
                            ),
                          )
                        }
                        className={`px-2.5 py-1 text-xs font-mono rounded ${
                          svc.enabled
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-[#E5E3DE] text-[#57544E]'
                        }`}
                      >
                        {svc.enabled ? 'Enabled' : 'Off'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setServices((prev) => prev.filter((_, i) => i !== idx))}
                        aria-label={`Remove ${svc.name}`}
                        className="p-1.5 text-[#C8232C] hover:bg-[#C8232C]/10 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add New Service Row */}
              <div className="rounded-lg border border-dashed border-[#CBC7BE] p-4 space-y-3">
                <p className="text-xs font-mono text-[#6B6760] uppercase">Add New Printing Service</p>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <input
                    type="text"
                    placeholder="Service name (e.g., Lamination)"
                    value={newServiceName}
                    onChange={(e) => setNewServiceName(e.target.value)}
                    className="rounded border border-[#D4D0C8] px-3 py-2 text-sm"
                  />
                  <select
                    value={newServiceCategory}
                    onChange={(e) =>
                      setNewServiceCategory(e.target.value as PrintingServiceItem['category'])
                    }
                    className="rounded border border-[#D4D0C8] px-3 py-2 text-sm"
                  >
                    <option value="document">Document</option>
                    <option value="printing">Printing</option>
                    <option value="finishing">Finishing</option>
                    <option value="delivery">Delivery</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    placeholder="Fee"
                    value={newServicePrice}
                    onChange={(e) => setNewServicePrice(e.target.value)}
                    className="rounded border border-[#D4D0C8] px-3 py-2 text-sm font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleAddService}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#141413] border border-[#D4D0C8] bg-[#FAF9F7] rounded-lg hover:bg-[#EFECE6]"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Service
                  </button>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={savingPricingServices}
              className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-[#141413] rounded-lg hover:bg-[#2C2A27] disabled:opacity-60"
            >
              {savingPricingServices && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Pricing Engine &amp; Services Catalog
            </button>
          </form>
        </section>
      ) : activeTab === 'settings' ? (
        <section className="no-print mt-8 max-w-2xl">
          <form
            onSubmit={handleSaveSettings}
            className="rounded-xl border border-[#E5E3DE] bg-white p-6 space-y-6"
          >
            <div>
              <h2 className="font-display text-lg font-semibold text-[#141413]">
                Storefront, Email &amp; WhatsApp Bot Settings
              </h2>
              <p className="text-xs text-[#57544E] mt-1">
                Configure display currency, payment account instructions, administrator order inbox email, and WhatsApp Business numbers (+23279576978).
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg border border-[#E5E3DE] bg-[#FAF9F7] p-3">
                <p className="font-mono text-[#6B6760]">EMAIL TRANSPORT</p>
                <p className="font-semibold text-[#141413] mt-0.5">
                  {emailApiConfigured ? 'Configured & Active' : 'Awaiting SMTP_USER / SMTP_PASS or RESEND_API_KEY'}
                </p>
              </div>
              <div className="rounded-lg border border-[#E5E3DE] bg-[#FAF9F7] p-3">
                <p className="font-mono text-[#6B6760]">WHATSAPP CLOUD API &amp; BOT</p>
                <p className="font-semibold text-[#141413] mt-0.5">
                  {whatsappApiConfigured ? 'Cloud API Active' : 'Click-to-Chat Active · Cloud Token Optional'} ·{' '}
                  {webhookConfigured ? 'Webhook Verified' : 'Set WHATSAPP_VERIFY_TOKEN'} ·{' '}
                  {botSecretConfigured ? 'Bot Auth Ready' : 'Set BOT_API_SECRET'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="admin-currency" className="block text-sm font-medium text-[#141413] mb-1.5">
                  Currency Code
                </label>
                <input
                  id="admin-currency"
                  type="text"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  placeholder="SLE"
                  className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm font-mono text-[#141413] focus:border-[#141413] focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="tpl-lang" className="block text-sm font-medium text-[#141413] mb-1.5">
                  WhatsApp Template Language
                </label>
                <input
                  id="tpl-lang"
                  type="text"
                  value={templateLang}
                  onChange={(e) => setTemplateLang(e.target.value)}
                  placeholder="en_US"
                  className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm font-mono text-[#141413] focus:border-[#141413] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="admin-notif-email" className="block text-sm font-medium text-[#141413] mb-1.5">
                Administrator Order Notification Email (Receives Files + Student Details)
              </label>
              <input
                id="admin-notif-email"
                type="email"
                value={adminNotificationEmail}
                onChange={(e) => setAdminNotificationEmail(e.target.value)}
                placeholder="badax1010@gmail.com"
                className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm font-mono text-[#141413] focus:border-[#141413] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="om-details" className="block text-sm font-medium text-[#141413] mb-1.5">
                Orange Money Official Payment Details
              </label>
              <textarea
                id="om-details"
                rows={2}
                value={orangeMoneyDetails}
                onChange={(e) => setOrangeMoneyDetails(e.target.value)}
                className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm text-[#141413] focus:border-[#141413] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="afri-details" className="block text-sm font-medium text-[#141413] mb-1.5">
                Africell Money (Afrimoney) Official Payment Details
              </label>
              <textarea
                id="afri-details"
                rows={2}
                value={afriMoneyDetails}
                onChange={(e) => setAfriMoneyDetails(e.target.value)}
                className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm text-[#141413] focus:border-[#141413] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="admin-wa-numbers" className="block text-sm font-medium text-[#141413] mb-1.5">
                Business WhatsApp Numbers (Sierra Leone +232, comma-separated)
              </label>
              <input
                id="admin-wa-numbers"
                type="text"
                value={adminNumbersText}
                onChange={(e) => setAdminNumbersText(e.target.value)}
                placeholder="23279576978"
                className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm font-mono text-[#141413] focus:border-[#141413] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="tpl-name" className="block text-sm font-medium text-[#141413] mb-1.5">
                Approved WhatsApp Document-Header Template Name (Optional)
              </label>
              <input
                id="tpl-name"
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g., dee_prints_new_order"
                className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3.5 py-2.5 text-sm font-mono text-[#141413] focus:border-[#141413] focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={savingSettings}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#141413] rounded-lg hover:bg-[#2C2A27] disabled:opacity-60 transition-colors"
            >
              {savingSettings && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Administrator Settings
            </button>
          </form>
        </section>
      ) : (
        <>
          {/* 12 KPI & Revenue Summary Cards */}
          <section className="no-print mt-8 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { label: 'Total Confirmed Revenue', val: `${activeCur} ${kpis.totalRevenue.toLocaleString()}` },
                { label: 'Daily Revenue (Today)', val: `${activeCur} ${kpis.dailyRevenue.toLocaleString()}` },
                { label: 'Monthly Revenue (This Month)', val: `${activeCur} ${kpis.monthlyRevenue.toLocaleString()}` },
              ].map((rev) => (
                <div
                  key={rev.label}
                  className="rounded-xl border border-[#D4D0C8] bg-white p-4"
                >
                  <p className="text-[11px] font-mono text-[#6B6760] uppercase">{rev.label}</p>
                  <p className="mt-1 font-mono text-2xl font-bold text-[#141413] tabular-nums">
                    {rev.val}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2.5">
              {[
                { label: 'Total Orders', val: kpis.total },
                { label: 'New Orders', val: kpis.newOrders },
                { label: 'Pending', val: kpis.pendingOrders },
                { label: 'Awaiting Pay', val: kpis.awaitingPayment },
                { label: 'Paid Orders', val: kpis.paidOrders },
                { label: 'Processing', val: kpis.processing },
                { label: 'Completed', val: kpis.completed },
                { label: 'Delivered', val: kpis.delivered },
                { label: 'Cancelled', val: kpis.cancelled },
              ].map((kpi) => (
                <div
                  key={kpi.label}
                  className="rounded-xl border border-[#E5E3DE] bg-white p-3"
                >
                  <p className="text-[11px] font-mono text-[#6B6760] truncate">{kpi.label}</p>
                  <p className="mt-1 font-mono text-xl font-bold text-[#141413] tabular-nums">
                    {kpi.val}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Search & Filters */}
          <section className="no-print mt-6 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-[#6B6760] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by Order ID (DEE-...), Student ID, name, phone, or title"
                className="w-full rounded-lg border border-[#D4D0C8] bg-white pl-10 pr-3.5 py-2 text-sm text-[#141413] placeholder:text-[#8A857C] focus:border-[#141413] focus:outline-none"
              />
            </div>

            <select
              aria-label="Filter by order status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-[#D4D0C8] bg-white px-3 py-2 text-xs font-medium text-[#141413] focus:border-[#141413] focus:outline-none"
            >
              <option value="ALL">All Order Statuses</option>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by payment status"
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value)}
              className="rounded-lg border border-[#D4D0C8] bg-white px-3 py-2 text-xs font-medium text-[#141413] focus:border-[#141413] focus:outline-none"
            >
              <option value="ALL">All Payment Statuses</option>
              <option value="PENDING">PENDING</option>
              <option value="CONFIRMED">CONFIRMED</option>
              <option value="FAILED">FAILED</option>
            </select>
          </section>

          {ordersError && (
            <div className="no-print mt-6 rounded-xl border border-[#C8232C]/30 bg-white p-5 text-sm text-[#C8232C]">
              <p className="font-semibold">Unable to read Firestore orders</p>
              <p className="mt-1 text-xs font-mono break-all">{ordersError}</p>
            </div>
          )}

          {/* Split Master/Detail View */}
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Orders List */}
            <section className="no-print lg:col-span-5 space-y-2.5">
              {loadingOrders ? (
                <div className="rounded-xl border border-[#E5E3DE] bg-white p-8 text-center text-sm text-[#57544E]">
                  Loading orders from Firestore...
                </div>
              ) : filteredOrders.length === 0 ? (
                <div className="rounded-xl border border-[#E5E3DE] bg-white p-8 text-center text-sm text-[#57544E]">
                  No orders match your current search or filters.
                </div>
              ) : (
                filteredOrders.map((order) => {
                  const active = order.orderId === selectedOrder?.orderId;
                  const normStatus = normalizeOrderStatus(order.status);
                  return (
                    <button
                      key={order.orderId}
                      type="button"
                      onClick={() => setSelectedOrderId(order.orderId)}
                      className={`w-full text-left rounded-xl border p-4 transition-colors ${
                        active
                          ? 'border-[#141413] bg-white shadow-xs'
                          : 'border-[#E5E3DE] bg-white/80 hover:border-[#BEB9AF] hover:bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-bold text-[#141413]">
                          {order.orderId}
                        </span>
                        <span className="text-[11px] font-mono text-[#57544E] tabular-nums">
                          {order.pricing?.currency} {order.pricing?.total?.toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-semibold text-[#141413] truncate">
                        {order.customer.fullName}{' '}
                        <span className="font-mono text-xs font-normal text-[#6B6760]">
                          ({order.customer.studentId})
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-[#57544E] truncate">
                        {order.documents?.length ? `${order.documents.length} file(s) · ` : ''}
                        {order.document.filename} · {order.document.pages}p × {order.printing.copies}
                      </p>
                      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                        <span className="text-[#141413] font-semibold">{normStatus}</span>
                        <span
                          className={
                            order.payment?.status === 'CONFIRMED'
                              ? 'text-emerald-700'
                              : order.payment?.status === 'FAILED'
                                ? 'text-[#C8232C]'
                                : 'text-amber-700'
                          }
                        >
                          PAY: {order.payment?.status || 'PENDING'}
                        </span>
                        {order.submissionMode === 'whatsapp_session' && (
                          <span className="text-emerald-700">BOT SESSION</span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </section>

            {/* Order Inspector */}
            <section className="lg:col-span-7">
              {!selectedOrder ? (
                <div className="no-print rounded-xl border border-[#E5E3DE] bg-white p-10 text-center text-sm text-[#57544E]">
                  Select an order on the left to inspect student details, download uploaded documents, print the brown envelope label, send a quotation, verify payment, or update status.
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="no-print rounded-xl border border-[#E5E3DE] bg-white p-6 space-y-6">
                    {/* Top Actions */}
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E5E3DE] pb-4">
                      <div>
                        <p className="font-mono text-xs text-[#6B6760]">ORDER REFERENCE</p>
                        <h2 className="font-display text-2xl font-bold text-[#141413] font-mono">
                          {selectedOrder.orderId}
                        </h2>
                        <p className="text-xs text-[#57544E] mt-1">
                          Submitted {new Date(selectedOrder.createdAt).toLocaleString()}
                          {selectedOrder.whatsappSession?.conversationRef
                            ? ` · WA Ref: ${selectedOrder.whatsappSession.conversationRef}`
                            : ''}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={actionBusy !== null}
                          onClick={() => void handleDownloadEnvelopeLabel(selectedOrder)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#141413] border border-[#D4D0C8] rounded-lg hover:bg-[#F3F1EC]"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          Download Label
                        </button>
                        <button
                          type="button"
                          onClick={handlePrintEnvelopeLabel}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#141413] border border-[#D4D0C8] rounded-lg hover:bg-[#F3F1EC]"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Print Label
                        </button>
                      </div>
                    </div>

                    {/* Uploaded Documents List */}
                    <div className="rounded-lg border border-[#E5E3DE] bg-[#FAF9F7] p-4 space-y-2.5">
                      <p className="text-xs font-mono font-semibold text-[#6B6760] uppercase">
                        Uploaded Documents ({selectedOrder.documents?.length || 1})
                      </p>
                      {(selectedOrder.documents && selectedOrder.documents.length > 0
                        ? selectedOrder.documents
                        : [
                            {
                              fileId: 'primary',
                              filename: selectedOrder.document.filename,
                              pages: selectedOrder.document.pages,
                              sizeBytes: selectedOrder.document.sizeBytes,
                              extension: 'pdf',
                            },
                          ]
                      ).map((docItem) => (
                        <div
                          key={docItem.fileId}
                          className="flex flex-wrap items-center justify-between gap-2 text-xs bg-white border border-[#E5E3DE] rounded-md px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-[#141413] truncate">
                              {docItem.filename}
                            </p>
                            <p className="font-mono text-[#6B6760]">
                              {String(docItem.extension || 'pdf').toUpperCase()} · {docItem.pages}p ·{' '}
                              {formatBytes(docItem.sizeBytes)}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={actionBusy !== null}
                            onClick={() =>
                              void handleDownloadDocument(
                                selectedOrder,
                                docItem.fileId,
                                docItem.filename,
                              )
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#141413] rounded hover:bg-[#2C2A27] disabled:opacity-60"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Customer & Print Breakdown */}
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                      <div>
                        <dt className="text-xs text-[#6B6760]">Student Name &amp; ID</dt>
                        <dd className="font-semibold text-[#141413]">
                          {selectedOrder.customer.fullName} ({selectedOrder.customer.studentId})
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#6B6760]">Contact Numbers</dt>
                        <dd className="font-mono text-[#141413] tabular-nums">
                          {selectedOrder.customer.whatsappPhone}
                          {selectedOrder.customer.altPhone
                            ? ` / Alt: ${selectedOrder.customer.altPhone}`
                            : ''}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#6B6760]">Institution &amp; Department</dt>
                        <dd className="text-[#141413]">
                          {selectedOrder.customer.institution} — {selectedOrder.customer.department}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#6B6760]">Course &amp; Lecturer</dt>
                        <dd className="text-[#141413]">
                          {selectedOrder.customer.course} ({selectedOrder.customer.lecturerName})
                        </dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-[#6B6760]">Assignment Title</dt>
                        <dd className="font-medium text-[#141413]">
                          {selectedOrder.customer.assignmentTitle}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#6B6760]">Print Configuration</dt>
                        <dd className="text-xs text-[#141413]">
                          {selectedOrder.printing.printType.toUpperCase()} ·{' '}
                          {selectedOrder.printing.sides} · {selectedOrder.printing.copies} copies ·{' '}
                          {selectedOrder.printing.envelopeQuantity} envelopes ·{' '}
                          {FINISHING_OPTIONS.find((f) => f.id === selectedOrder.printing.finishing)?.label}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#6B6760]">Delivery / Collection</dt>
                        <dd className="text-xs text-[#141413]">
                          {selectedOrder.delivery.method === 'campus_delivery'
                            ? selectedOrder.delivery.location
                            : 'Print Shop Collection'}{' '}
                          ({selectedOrder.delivery.timeWindow})
                        </dd>
                      </div>
                      {selectedOrder.selectedServices && selectedOrder.selectedServices.length > 0 && (
                        <div className="sm:col-span-2">
                          <dt className="text-xs text-[#6B6760]">Selected Services</dt>
                          <dd className="text-xs text-[#141413]">
                            {selectedOrder.selectedServices
                              .map((id) => services.find((s) => s.id === id)?.name || id)
                              .join(' · ')}
                          </dd>
                        </div>
                      )}
                    </dl>

                    {/* Itemized Price */}
                    <div className="rounded-lg border border-[#E5E3DE] bg-[#FAF9F7] p-4 text-xs space-y-1.5">
                      <p className="font-mono font-semibold text-[#6B6760] uppercase">
                        Itemized Price Breakdown
                      </p>
                      <div className="flex justify-between">
                        <span>Printing Cost</span>
                        <span className="font-mono tabular-nums">
                          {selectedOrder.pricing.currency}{' '}
                          {(
                            selectedOrder.pricing.printingCost ??
                            selectedOrder.pricing.bwCost + selectedOrder.pricing.colorCost
                          ).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Packaging (Envelopes + Binding)</span>
                        <span className="font-mono tabular-nums">
                          {selectedOrder.pricing.currency}{' '}
                          {(
                            selectedOrder.pricing.packagingCost ??
                            selectedOrder.pricing.envelopeCost
                          ).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Additional Services</span>
                        <span className="font-mono tabular-nums">
                          {selectedOrder.pricing.currency}{' '}
                          {(selectedOrder.pricing.additionalServicesCost ?? 0).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Delivery Fee</span>
                        <span className="font-mono tabular-nums">
                          {selectedOrder.pricing.currency}{' '}
                          {(selectedOrder.pricing.deliveryFee ?? 0).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Approved Extra Charges</span>
                        <span className="font-mono tabular-nums">
                          {selectedOrder.pricing.currency}{' '}
                          {selectedOrder.pricing.additionalCharges}
                        </span>
                      </div>
                      <div className="pt-2 border-t border-[#E5E3DE] flex justify-between text-sm font-bold text-[#141413]">
                        <span>Total</span>
                        <span className="font-mono tabular-nums">
                          {selectedOrder.pricing.currency}{' '}
                          {selectedOrder.pricing.total.toLocaleString()}
                        </span>
                      </div>
                    </div>

                    {/* Order Status & Payment Verification Controls */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#E5E3DE]">
                      <div>
                        <label
                          htmlFor="admin-status-select"
                          className="block text-xs font-mono text-[#6B6760] uppercase mb-1.5"
                        >
                          Order Fulfillment Status
                        </label>
                        <select
                          id="admin-status-select"
                          disabled={actionBusy !== null}
                          value={normalizeOrderStatus(selectedOrder.status)}
                          onChange={(e) =>
                            void handleStatusChange(selectedOrder, e.target.value as OrderStatus)
                          }
                          className="w-full rounded-lg border border-[#D4D0C8] bg-white px-3 py-2 text-sm font-medium text-[#141413] focus:border-[#141413] focus:outline-none"
                        >
                          {ALL_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <span className="block text-xs font-mono text-[#6B6760] uppercase mb-1.5">
                          Payment ({PAYMENT_OPTIONS.find((p) => p.id === selectedOrder.payment.method)?.label})
                        </span>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={actionBusy !== null || selectedOrder.payment.status === 'CONFIRMED'}
                            onClick={() => void handlePaymentStatusChange(selectedOrder, 'CONFIRMED')}
                            className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Confirm
                          </button>
                          <button
                            type="button"
                            disabled={actionBusy !== null || selectedOrder.payment.status === 'FAILED'}
                            onClick={() => void handlePaymentStatusChange(selectedOrder, 'FAILED')}
                            className="px-3 py-2 text-xs font-semibold text-[#C8232C] border border-[#C8232C]/40 rounded-lg hover:bg-[#C8232C]/5 disabled:opacity-50"
                          >
                            Mark Failed
                          </button>
                        </div>
                        {selectedOrder.payment.reference && (
                          <p className="mt-1.5 text-xs font-mono text-[#57544E]">
                            Ref: {selectedOrder.payment.reference}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Quotation & Approved Extra Charges */}
                    <div className="pt-4 border-t border-[#E5E3DE] space-y-3">
                      <p className="text-xs font-mono text-[#6B6760] uppercase">
                        Quotation &amp; Additional Charges
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <input
                          type="number"
                          min={0}
                          value={extraChargeInput}
                          onChange={(e) => setExtraChargeInput(e.target.value)}
                          className="w-28 rounded-lg border border-[#D4D0C8] px-3 py-1.5 text-sm font-mono tabular-nums"
                          aria-label="Additional charge amount"
                        />
                        <input
                          type="text"
                          value={extraChargeNote}
                          onChange={(e) => setExtraChargeNote(e.target.value)}
                          placeholder="Charge reason (optional)"
                          className="flex-1 min-w-[160px] rounded-lg border border-[#D4D0C8] px-3 py-1.5 text-sm"
                        />
                        <button
                          type="button"
                          disabled={actionBusy !== null}
                          onClick={() => void handleSaveAdditionalCharges(selectedOrder)}
                          className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#141413] rounded-lg hover:bg-[#2C2A27] disabled:opacity-50"
                        >
                          Apply Charge
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <input
                          type="text"
                          value={quoteSummaryInput}
                          onChange={(e) => setQuoteSummaryInput(e.target.value)}
                          placeholder="Custom quotation note shown on Order Tracking..."
                          className="flex-1 min-w-[200px] rounded-lg border border-[#D4D0C8] px-3 py-1.5 text-sm"
                        />
                        <button
                          type="button"
                          disabled={actionBusy !== null}
                          onClick={() => void handleSendAdminQuotation(selectedOrder)}
                          className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#C8232C] rounded-lg hover:bg-[#AE1D25] disabled:opacity-50"
                        >
                          Publish Quotation
                        </button>
                      </div>
                    </div>

                    {/* Email & WhatsApp Notification Status & Retry */}
                    <div className="pt-4 border-t border-[#E5E3DE] space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-mono text-[#6B6760] uppercase">
                            Email Dispatch ({adminNotificationEmail})
                          </p>
                          <p className="text-sm font-medium text-[#141413] mt-0.5">
                            Status: {selectedOrder.emailNotification?.status || 'PENDING'} · Attempts:{' '}
                            {selectedOrder.emailNotification?.attempts || 0}
                          </p>
                          {selectedOrder.emailNotification?.lastError && (
                            <p className="text-xs text-[#C8232C] mt-1">
                              {selectedOrder.emailNotification.lastError}
                            </p>
                          )}
                        </div>

                        <button
                          type="button"
                          disabled={actionBusy !== null}
                          onClick={() => void handleRetryEmail(selectedOrder)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border border-[#D4D0C8] bg-white text-[#141413] rounded-lg hover:bg-[#F3F1EC] disabled:opacity-50"
                        >
                          <Mail className={`w-3.5 h-3.5 ${actionBusy === 'email' ? 'animate-pulse' : ''}`} />
                          Retry Email Send
                        </button>
                      </div>

                      <div className="pt-3 border-t border-[#ECEAE4] flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-mono text-[#6B6760] uppercase">
                            WhatsApp Cloud Notification
                          </p>
                          <p className="text-sm font-medium text-[#141413] mt-0.5">
                            Status: {selectedOrder.whatsappNotification?.status || 'PENDING'} · Attempts:{' '}
                            {selectedOrder.whatsappNotification?.attempts || 0}
                          </p>
                          {selectedOrder.whatsappNotification?.lastError && (
                            <p className="text-xs text-[#C8232C] mt-1">
                              {selectedOrder.whatsappNotification.lastError}
                            </p>
                          )}
                        </div>

                        <button
                          type="button"
                          disabled={actionBusy !== null}
                          onClick={() => void handleRetryWhatsApp(selectedOrder)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border border-[#D4D0C8] bg-white text-[#141413] rounded-lg hover:bg-[#F3F1EC] disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${actionBusy === 'retry' ? 'animate-spin' : ''}`} />
                          Retry WhatsApp Send
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Printable Envelope Label Preview */}
                  <div>
                    <p className="no-print text-xs font-mono text-[#6B6760] uppercase mb-2">
                      Printable Personalized Brown Envelope Label
                    </p>
                    <EnvelopePreview
                      customer={selectedOrder.customer}
                      envelopeQuantity={selectedOrder.printing.envelopeQuantity}
                      copies={selectedOrder.printing.copies}
                      finishingLabel={
                        FINISHING_OPTIONS.find((f) => f.id === selectedOrder.printing.finishing)
                          ?.label || selectedOrder.printing.finishing
                      }
                      envelopeNote={selectedOrder.envelopeLabel?.note}
                      orderId={selectedOrder.orderId}
                    />
                  </div>

                  {/* Audit Trail */}
                  <div className="no-print rounded-xl border border-[#E5E3DE] bg-white p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <History className="w-4 h-4 text-[#57544E]" />
                      <h3 className="font-display text-sm font-semibold text-[#141413]">
                        Administrator Audit Trail
                      </h3>
                    </div>
                    {auditEntries.length === 0 ? (
                      <p className="text-xs text-[#6B6760]">No administrator modifications logged yet.</p>
                    ) : (
                      <ul className="space-y-2 text-xs">
                        {auditEntries.map((entry, idx) => (
                          <li
                            key={entry.id || idx}
                            className="border-b border-[#ECEAE4] pb-2 last:border-b-0 last:pb-0"
                          >
                            <div className="flex justify-between gap-2 font-mono text-[#141413]">
                              <span className="font-semibold">{entry.action}</span>
                              <span className="text-[#6B6760]">
                                {new Date(entry.createdAt).toLocaleString()}
                              </span>
                            </div>
                            <p className="text-[#57544E] mt-0.5">{entry.note}</p>
                            <p className="text-[11px] font-mono text-[#6B6760]">
                              {entry.previousValue} → {entry.newValue} · by {entry.actorEmail}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
};

export const AdminDashboard: React.FC<{ onBackHome: () => void }> = ({ onBackHome }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    return subscribeToAuth((nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
  }, []);

  const handleSignIn = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInAdminWithGoogle();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    } finally {
      setSigningIn(false);
    }
  };

  if (!authReady) {
    return (
      <main className="max-w-lg mx-auto px-6 py-20 text-center">
        <p className="text-sm text-[#57544E]">Checking administrator session...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="max-w-lg mx-auto px-6 py-20">
        <div className="rounded-xl border border-[#E5E3DE] bg-white p-8">
          <div className="w-11 h-11 rounded-lg bg-[#F3F1EC] flex items-center justify-center mb-4">
            <Lock className="w-5 h-5 text-[#141413]" />
          </div>
          <h1 className="font-display text-2xl font-bold text-[#141413]">
            DEE PRINTS Administrator Sign-In
          </h1>
          <p className="mt-2 text-sm text-[#57544E]">
            Access to student orders, uploaded documents, revenue metrics, pricing configuration, and studio settings is restricted to verified administrators.
          </p>
          {authError && (
            <p className="mt-3 text-xs text-[#C8232C] font-medium">{authError}</p>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={signingIn}
              onClick={() => void handleSignIn()}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#C8232C] rounded-lg hover:bg-[#AE1D25] disabled:opacity-60"
            >
              <ShieldCheck className="w-4 h-4" />
              {signingIn ? 'Signing in...' : 'Sign in with Google'}
            </button>
            <button
              type="button"
              onClick={onBackHome}
              className="px-4 py-2.5 text-sm font-medium border border-[#D4D0C8] rounded-lg text-[#141413] hover:bg-[#F3F1EC]"
            >
              Return to Print Studio
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!isAuthorizedAdminUser(user)) {
    return (
      <main className="max-w-lg mx-auto px-6 py-20">
        <div className="rounded-xl border border-[#C8232C]/30 bg-white p-8">
          <div className="w-11 h-11 rounded-lg bg-[#C8232C]/10 flex items-center justify-center mb-4">
            <AlertTriangle className="w-5 h-5 text-[#C8232C]" />
          </div>
          <h1 className="font-display text-xl font-bold text-[#141413]">
            Unauthorized Account
          </h1>
          <p className="mt-2 text-sm text-[#57544E]">
            Signed in as <span className="font-mono text-[#141413]">{user.email}</span>. Administrator access is restricted to{' '}
            <span className="font-mono text-[#141413]">{ADMIN_EMAIL}</span>.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void signOutAdmin()}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#141413] rounded-lg hover:bg-[#2C2A27]"
            >
              Sign Out &amp; Switch Account
            </button>
            <button
              type="button"
              onClick={onBackHome}
              className="px-4 py-2 text-sm font-medium border border-[#D4D0C8] rounded-lg text-[#141413] hover:bg-[#F3F1EC]"
            >
              Back Home
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <AdminErrorBoundary>
      <AdminDashboardContent user={user} />
    </AdminErrorBoundary>
  );
};
