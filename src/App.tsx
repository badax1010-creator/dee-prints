import { useEffect, useState } from 'react';
import { ArrowRight, MessageSquare } from 'lucide-react';
import { AdminDashboard } from './components/AdminDashboard';
import { BrandLogo } from './components/BrandLogo';
import { OrderSheetView } from './components/OrderSheetView';
import { OrderTrackingView } from './components/OrderTrackingView';
import { StudioImage } from './components/StudioImage';
import { TopBar } from './components/TopBar';
import { fetchPricingConfig, fetchServicesCatalog } from './firebase';
import {
  DEFAULT_PRICING_CONFIG,
  DEFAULT_PRINTING_SERVICES,
  PricingConfig,
  PrintingServiceItem,
} from './types';

type ActiveRoute =
  | { view: 'home' }
  | { view: 'admin' }
  | { view: 'track'; initialRef?: string }
  | { view: 'order'; orderId: string };

const WHATSAPP_DIRECT_ORDER_URL =
  'https://wa.me/23279576978?text=Hello%20DEE%20PRINTS!%20I%20want%20to%20place%20a%20printing%20order.%0A%0AI%20am%20ready%20to%20send%20my%20document%2FPDF%20and%20printing%20instructions%20here.';

function resolveRouteFromPath(pathname: string, search = ''): ActiveRoute {
  if (/^\/admin\/?$/i.test(pathname)) {
    return { view: 'admin' };
  }
  if (/^\/track\/?$/i.test(pathname)) {
    const params = new URLSearchParams(search);
    return { view: 'track', initialRef: (params.get('ref') || '').toUpperCase() };
  }
  const orderMatch = pathname.match(/^\/order\/((?:DEE|LIM)-[A-Z0-9-]+)\/?$/i);
  if (orderMatch) {
    return { view: 'order', orderId: orderMatch[1].toUpperCase() };
  }
  return { view: 'home' };
}

export default function App() {
  const [route, setRoute] = useState<ActiveRoute>(() =>
    resolveRouteFromPath(window.location.pathname, window.location.search),
  );
  const [pricingConfig, setPricingConfig] = useState<PricingConfig>(DEFAULT_PRICING_CONFIG);
  const [servicesCatalog, setServicesCatalog] = useState<PrintingServiceItem[]>(DEFAULT_PRINTING_SERVICES);

  useEffect(() => {
    const onPopState = () => {
      setRoute(resolveRouteFromPath(window.location.pathname, window.location.search));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (route.view !== 'home') return;
    let active = true;
    Promise.all([fetchPricingConfig(), fetchServicesCatalog()]).then(([pricing, services]) => {
      if (!active) return;
      setPricingConfig(pricing);
      setServicesCatalog(services);
    });
    return () => {
      active = false;
    };
  }, [route.view]);

  const navigateToTrack = (orderId = '') => {
    const cleanRef = orderId.trim().toUpperCase();
    const nextPath = cleanRef ? `/track?ref=${encodeURIComponent(cleanRef)}` : '/track';
    window.history.pushState({}, '', nextPath);
    setRoute({ view: 'track', initialRef: cleanRef });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigateToAdmin = () => {
    window.history.pushState({}, '', '/admin');
    setRoute({ view: 'admin' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigateHome = () => {
    window.history.pushState({}, '', '/');
    setRoute({ view: 'home' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (route.view === 'admin') {
    return (
      <div className="min-h-screen flex flex-col bg-[#FAF9F7] text-[#141413]">
        <TopBar
          activeView="admin"
          onBackHome={navigateHome}
          onOpenAdmin={navigateToAdmin}
          whatsappOrderUrl={WHATSAPP_DIRECT_ORDER_URL}
        />
        <div className="flex-1">
          <AdminDashboard onBackHome={navigateHome} />
        </div>
      </div>
    );
  }

  if (route.view === 'track') {
    return (
      <div className="min-h-screen flex flex-col bg-[#FAF9F7] text-[#141413]">
        <TopBar
          activeView="track"
          onBackHome={navigateHome}
          onOpenAdmin={navigateToAdmin}
          whatsappOrderUrl={WHATSAPP_DIRECT_ORDER_URL}
        />
        <div className="flex-1">
          <OrderTrackingView initialRef={route.initialRef} onBackHome={navigateHome} />
        </div>
      </div>
    );
  }

  if (route.view === 'order') {
    return (
      <div className="min-h-screen flex flex-col bg-[#FAF9F7] text-[#141413]">
        <TopBar
          activeView="order"
          onBackHome={navigateHome}
          onOpenAdmin={navigateToAdmin}
          whatsappOrderUrl={WHATSAPP_DIRECT_ORDER_URL}
        />
        <div className="flex-1">
          <OrderSheetView
            orderId={route.orderId}
            onBackHome={navigateHome}
            onOpenTrack={(id) => navigateToTrack(id)}
          />
        </div>
      </div>
    );
  }

  const enabledServices = servicesCatalog.filter((s) => s.enabled);

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF9F7] text-[#141413]">
      <TopBar
        activeView="home"
        onOpenAdmin={navigateToAdmin}
        whatsappOrderUrl={WHATSAPP_DIRECT_ORDER_URL}
      />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="max-w-[1240px] mx-auto px-6 pt-12 pb-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-between py-2">
              <div>
                <p className="text-sm font-medium text-[#57544E]">
                  DEE PRINTS · University &amp; College Assignment Printing
                </p>
                <h1
                  className="font-display font-bold tracking-tight text-[#141413] mt-4 text-balance"
                  style={{ fontSize: 'clamp(2.25rem, 4vw, 3.6rem)', lineHeight: 1.08 }}
                >
                  Press Order to print directly via WhatsApp.
                </h1>
                <p className="mt-5 text-base sm:text-lg text-[#57544E] leading-relaxed max-w-xl">
                  No website forms to fill out. Tap Order to open DEE PRINTS on WhatsApp, send your assignment PDF or Word document there, and share your copies, binding, and envelope details directly.
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-5">
                  <a
                    href={WHATSAPP_DIRECT_ORDER_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2.5 px-6 py-3.5 text-sm font-semibold text-white bg-[#C8232C] rounded-lg hover:bg-[#AE1D25] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141413]"
                  >
                    <MessageSquare className="w-4 h-4" />
                    Order on WhatsApp
                    <ArrowRight className="w-4 h-4" />
                  </a>
                  <a
                    href="#services"
                    className="text-sm font-semibold text-[#141413] hover:underline underline-offset-4 whitespace-nowrap shrink-0"
                  >
                    View services &amp; rates
                  </a>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="rounded-xl overflow-hidden border border-[#E5E3DE] bg-[#EFECE6] h-full min-h-[280px] lg:min-h-[380px]">
                <StudioImage
                  src="/src/assets/images/hero_print_studio_1795520648339.jpg"
                  alt="Printed student assignments, spiral-bound booklets, and a personalized brown kraft submission envelope"
                  titleFallback="DEE PRINTS Campus Studio"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>

          {/* 4-Column Simple Ordering Flow */}
          <div
            id="how-it-works"
            className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-[#E5E3DE] rounded-xl bg-white divide-y sm:divide-y-0 sm:divide-x divide-[#E5E3DE]"
          >
            <div className="p-5">
              <p className="text-xs font-mono text-[#6B6760]">01. PRESS ORDER</p>
              <p className="font-display text-base font-semibold text-[#141413] mt-1">
                Direct to WhatsApp
              </p>
              <p className="text-xs text-[#57544E] mt-1">
                One tap opens our WhatsApp print line—no forms or account needed.
              </p>
            </div>
            <div className="p-5">
              <p className="text-xs font-mono text-[#6B6760]">02. SEND YOUR FILE</p>
              <p className="font-display text-base font-semibold text-[#141413] mt-1">
                PDF, DOC &amp; Images
              </p>
              <p className="text-xs text-[#57544E] mt-1">
                Attach your assignment, project, or slides directly inside the chat.
              </p>
            </div>
            <div className="p-5">
              <p className="text-xs font-mono text-[#6B6760]">03. PRINT &amp; ENVELOPE</p>
              <p className="font-display text-base font-semibold text-[#141413] mt-1">
                Custom Finishing
              </p>
              <p className="text-xs text-[#57544E] mt-1">
                Send your copy count, binding preference, and brown envelope label text.
              </p>
            </div>
            <div className="p-5">
              <p className="text-xs font-mono text-[#6B6760]">04. PICK UP OR DELIVER</p>
              <p className="font-display text-base font-semibold text-[#141413] mt-1">
                Fast Campus Handoff
              </p>
              <p className="text-xs text-[#57544E] mt-1">
                Confirm payment on WhatsApp and collect cleanly packaged copies.
              </p>
            </div>
          </div>
        </section>

        {/* Services & Standard Print Rates (Read-Only Showcase) */}
        <section id="services" className="border-t border-[#E5E3DE] py-16">
          <div className="max-w-[1240px] mx-auto px-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
              <div className="max-w-2xl">
                <p className="text-xs font-mono text-[#6B6760] uppercase tracking-wider">
                  Printing Services &amp; Standard Rates
                </p>
                <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#141413] mt-2 text-balance">
                  Everything you need for assignments, projects, and exam prep.
                </h2>
              </div>
              <a
                href={WHATSAPP_DIRECT_ORDER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-[#141413] rounded-lg hover:bg-[#2C2A27] transition-colors whitespace-nowrap shrink-0"
              >
                <MessageSquare className="w-4 h-4" />
                Order on WhatsApp
              </a>
            </div>

            {/* Key Rate Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <div className="rounded-xl border border-[#E5E3DE] bg-white p-5">
                <p className="text-xs font-mono text-[#6B6760]">BLACK &amp; WHITE A4</p>
                <p className="font-mono text-2xl font-bold text-[#141413] mt-2 tabular-nums">
                  {pricingConfig.currency} {pricingConfig.bwPagePrice}
                </p>
                <p className="text-xs text-[#57544E] mt-1">Per sheet</p>
              </div>
              <div className="rounded-xl border border-[#E5E3DE] bg-white p-5">
                <p className="text-xs font-mono text-[#6B6760]">COLOUR A4</p>
                <p className="font-mono text-2xl font-bold text-[#141413] mt-2 tabular-nums">
                  {pricingConfig.currency} {pricingConfig.colorPagePrice}
                </p>
                <p className="text-xs text-[#57544E] mt-1">Per sheet</p>
              </div>
              <div className="rounded-xl border border-[#E5E3DE] bg-white p-5">
                <p className="text-xs font-mono text-[#6B6760]">BROWN ENVELOPE</p>
                <p className="font-mono text-2xl font-bold text-[#141413] mt-2 tabular-nums">
                  {pricingConfig.currency} {pricingConfig.brownEnvelopePrice}
                </p>
                <p className="text-xs text-[#57544E] mt-1">With printed student label</p>
              </div>
              <div className="rounded-xl border border-[#E5E3DE] bg-white p-5">
                <p className="text-xs font-mono text-[#6B6760]">FINISHING &amp; BINDING</p>
                <p className="font-mono text-2xl font-bold text-[#141413] mt-2 tabular-nums">
                  {pricingConfig.bindingPrice > 0
                    ? `${pricingConfig.currency} ${pricingConfig.bindingPrice}`
                    : 'Available'}
                </p>
                <p className="text-xs text-[#57544E] mt-1">Spiral, thermal &amp; stapling</p>
              </div>
            </div>

            {/* Clean Catalog Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {enabledServices.map((svc, idx) => (
                <div
                  key={svc.id}
                  className="rounded-xl border border-[#E5E3DE] bg-white p-5 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-xs font-mono text-[#6B6760] tabular-nums">
                        {String(idx + 1).padStart(2, '0')}.
                      </span>
                      <span className="text-xs font-mono text-[#6B6760] tabular-nums">
                        {svc.price > 0 ? `${pricingConfig.currency} ${svc.price} · ` : ''}
                        {svc.unitLabel}
                      </span>
                    </div>
                    <h3 className="font-display text-base font-semibold text-[#141413] mt-2">
                      {svc.name}
                    </h3>
                    <p className="mt-1.5 text-xs text-[#57544E] leading-relaxed">
                      {svc.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Binding & Envelope Reference Showcase */}
        <section
          id="finishing-guide"
          className="border-t border-[#E5E3DE] bg-[#F3F1EC]/70 py-16"
        >
          <div className="max-w-[1240px] mx-auto px-6">
            <div className="max-w-2xl mb-10">
              <p className="text-xs font-mono text-[#6B6760] uppercase tracking-wider">
                Finishing &amp; Envelope Standards
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#141413] mt-2 text-balance">
                Built to meet university and college submission standards.
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <article className="rounded-xl border border-[#E5E3DE] bg-white overflow-hidden flex flex-col">
                <div className="aspect-[4/3] bg-[#EFECE6] overflow-hidden">
                  <StudioImage
                    src="/src/assets/images/binding_spiral_comb_1795520648751.jpg"
                    alt="Spiral-bound university assignment with clear frosted acetate front cover"
                    titleFallback="Spiral Comb Binding"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-6 flex-1">
                  <h3 className="font-display text-lg font-semibold text-[#141413]">
                    Spiral Binding
                  </h3>
                  <p className="mt-2 text-sm text-[#57544E] leading-relaxed">
                    Opens 360 degrees flat for design critiques and studio reviews with a clear front cover over your title page.
                  </p>
                </div>
              </article>

              <article className="rounded-xl border border-[#E5E3DE] bg-white overflow-hidden flex flex-col">
                <div className="aspect-[4/3] bg-[#EFECE6] overflow-hidden">
                  <StudioImage
                    src="/src/assets/images/binding_thermal_cover_1795520648990.jpg"
                    alt="Black thermal-bound academic report next to corner-stapled A4 printed sheets"
                    titleFallback="Thermal & Stapled Finishes"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-6 flex-1">
                  <h3 className="font-display text-lg font-semibold text-[#141413]">
                    Thermal &amp; Stapled Finishes
                  </h3>
                  <p className="mt-2 text-sm text-[#57544E] leading-relaxed">
                    Clean spine finishing for dissertations and reports, or fast corner-stapling for weekly lecture submissions.
                  </p>
                </div>
              </article>

              <article className="rounded-xl border border-[#E5E3DE] bg-white overflow-hidden flex flex-col">
                <div className="aspect-[4/3] bg-[#EFECE6] overflow-hidden">
                  <StudioImage
                    src="/src/assets/images/envelope_labeled_kraft_1795520649128.jpg"
                    alt="Brown kraft A4 assignment envelope with printed student identification label"
                    titleFallback="Personalized Brown Envelope"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-6 flex-1">
                  <h3 className="font-display text-lg font-semibold text-[#141413]">
                    Personalized Brown Envelopes
                  </h3>
                  <p className="mt-2 text-sm text-[#57544E] leading-relaxed">
                    Printed with your Name, Student ID, Department, Course, Lecturer, and Assignment Title—just send the details in chat.
                  </p>
                </div>
              </article>
            </div>

            {/* Bottom Direct WhatsApp Callout */}
            <div className="mt-12 rounded-xl border border-[#D4D0C8] bg-white p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <div>
                <h3 className="font-display text-xl sm:text-2xl font-bold text-[#141413]">
                  Ready to print your document?
                </h3>
                <p className="mt-1.5 text-sm text-[#57544E]">
                  Click Order to chat directly with DEE PRINTS on WhatsApp and send your files.
                </p>
              </div>
              <a
                href={WHATSAPP_DIRECT_ORDER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 text-sm font-semibold text-white bg-[#C8232C] rounded-lg hover:bg-[#AE1D25] transition-colors whitespace-nowrap shrink-0"
              >
                <MessageSquare className="w-4 h-4" />
                Order on WhatsApp
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#E5E3DE] bg-[#FAF9F7]">
        <div className="max-w-[1240px] mx-auto px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-sm text-[#57544E]">
          <div className="flex flex-wrap items-center gap-2">
            <BrandLogo size="sm" />
            <span aria-hidden="true">·</span>
            <span>Direct WhatsApp Student Printing &amp; Envelope Service</span>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <a
              href={WHATSAPP_DIRECT_ORDER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[#141413] transition-colors"
            >
              Order on WhatsApp
            </a>
            <a href="#services" className="hover:text-[#141413] transition-colors">
              Services &amp; Rates
            </a>
            <a href="#finishing-guide" className="hover:text-[#141413] transition-colors">
              Finishing Guide
            </a>
            <a
              href="/admin"
              onClick={(e) => {
                e.preventDefault();
                navigateToAdmin();
              }}
              className="hover:text-[#141413] transition-colors"
            >
              Admin
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
