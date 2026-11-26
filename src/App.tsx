import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { AdminDashboard } from './components/AdminDashboard';
import { BrandLogo } from './components/BrandLogo';
import { OrderSheetView } from './components/OrderSheetView';
import { OrderTrackingView } from './components/OrderTrackingView';
import { PrintStudio } from './components/PrintStudio';
import { StudioImage } from './components/StudioImage';
import { TopBar } from './components/TopBar';

type ActiveRoute =
  | { view: 'home' }
  | { view: 'admin' }
  | { view: 'track'; initialRef?: string }
  | { view: 'order'; orderId: string };

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

  useEffect(() => {
    const onPopState = () => {
      setRoute(resolveRouteFromPath(window.location.pathname, window.location.search));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const scrollToStudio = () => {
    const el = document.getElementById('print-studio');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const navigateToOrderSheet = (orderId: string, signedSearch = '') => {
    const nextPath = `/order/${encodeURIComponent(orderId)}${signedSearch}`;
    window.history.pushState({}, '', nextPath);
    setRoute({ view: 'order', orderId });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

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
          onOpenTrack={() => navigateToTrack()}
          onOpenAdmin={navigateToAdmin}
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
          onOpenTrack={() => navigateToTrack()}
          onOpenAdmin={navigateToAdmin}
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
          onOpenTrack={() => navigateToTrack()}
          onOpenAdmin={navigateToAdmin}
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

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF9F7] text-[#141413]">
      <TopBar
        activeView="home"
        onStartOrder={scrollToStudio}
        onOpenTrack={() => navigateToTrack()}
        onOpenAdmin={navigateToAdmin}
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
                  Upload once. Continue on WhatsApp or finish online.
                </h1>
                <p className="mt-5 text-base sm:text-lg text-[#57544E] leading-relaxed max-w-xl">
                  Upload your assignment PDF, DOC, or DOCX documents, customize your brown submission envelope, and send your order directly to our WhatsApp line without re-uploading files.
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-5">
                  <button
                    type="button"
                    onClick={scrollToStudio}
                    className="inline-flex items-center gap-2.5 px-6 py-3.5 text-sm font-semibold text-white bg-[#C8232C] rounded-lg hover:bg-[#AE1D25] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141413]"
                  >
                    Order Now / Upload Assignment
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateToTrack()}
                    className="text-sm font-semibold text-[#141413] hover:underline underline-offset-4 whitespace-nowrap shrink-0"
                  >
                    Track existing order
                  </button>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="rounded-xl overflow-hidden border border-[#E5E3DE] bg-[#EFECE6] h-full min-h-[280px] lg:min-h-[380px]">
                <StudioImage
                  src="/src/assets/images/limkokwing_sl_facade.jpg"
                  alt="Limkokwing University of Creative Technology Sierra Leone campus facade at Hill Station, Freetown"
                  titleFallback="Limkokwing University Sierra Leone"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>

          {/* 4-Column Studio Specs Strip */}
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-[#E5E3DE] rounded-xl bg-white divide-y sm:divide-y-0 sm:divide-x divide-[#E5E3DE]">
            <div className="p-5">
              <p className="text-xs font-mono text-[#6B6760]">01. UPLOAD DOC</p>
              <p className="font-display text-base font-semibold text-[#141413] mt-1">
                PDF, DOC &amp; DOCX
              </p>
              <p className="text-xs text-[#57544E] mt-1">
                Multi-file upload with automatic PDF page counting.
              </p>
            </div>
            <div className="p-5">
              <p className="text-xs font-mono text-[#6B6760]">02. CONTINUE OR ORDER</p>
              <p className="font-display text-base font-semibold text-[#141413] mt-1">
                Direct WhatsApp Line
              </p>
              <p className="text-xs text-[#57544E] mt-1">
                Uploads securely first and sends your Order Reference + file link straight to WhatsApp.
              </p>
            </div>
            <div className="p-5">
              <p className="text-xs font-mono text-[#6B6760]">03. BROWN ENVELOPE</p>
              <p className="font-display text-base font-semibold text-[#141413] mt-1">
                Custom Printed Label
              </p>
              <p className="text-xs text-[#57544E] mt-1">
                Name, Student ID, Department, Course, Lecturer &amp; Title synced live.
              </p>
            </div>
            <div className="p-5">
              <p className="text-xs font-mono text-[#6B6760]">04. LIVE TRACKING</p>
              <p className="font-display text-base font-semibold text-[#141413] mt-1">
                7-Stage Progress
              </p>
              <p className="text-xs text-[#57544E] mt-1">
                Check payment confirmation, printing status, and campus delivery anytime.
              </p>
            </div>
          </div>
        </section>

        {/* Automated Print Studio Workspace */}
        <section className="border-t border-[#E5E3DE]">
          <PrintStudio
            onOpenOrderSheet={navigateToOrderSheet}
            onOpenTrack={navigateToTrack}
          />
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
                    src="/src/assets/images/limkokwing_sl_campus.jpg"
                    alt="Students inside Limkokwing University Sierra Leone campus hall at Hill Station, Freetown"
                    titleFallback="Limkokwing Sierra Leone Campus"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-6 flex-1">
                  <h3 className="font-display text-lg font-semibold text-[#141413]">
                    Spiral Binding &amp; Campus Rush
                  </h3>
                  <p className="mt-2 text-sm text-[#57544E] leading-relaxed">
                    Serving Limkokwing Sierra Leone students with 360-degree spiral binding and clear front covers ready for studio critiques and presentations.
                  </p>
                </div>
              </article>

              <article className="rounded-xl border border-[#E5E3DE] bg-white overflow-hidden flex flex-col">
                <div className="aspect-[4/3] bg-[#EFECE6] overflow-hidden">
                  <StudioImage
                    src="/src/assets/images/limkokwing_sl_hillstation.png"
                    alt="Limkokwing University of Creative Technology Sierra Leone main building at Hill Station, Freetown"
                    titleFallback="Limkokwing Hill Station Campus"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-6 flex-1">
                  <h3 className="font-display text-lg font-semibold text-[#141413]">
                    Thermal &amp; Stapled Finishes
                  </h3>
                  <p className="mt-2 text-sm text-[#57544E] leading-relaxed">
                    Clean thermal spine binding for final-year projects and dissertations, or fast corner-stapling for weekly faculty submissions at Hill Station.
                  </p>
                </div>
              </article>

              <article className="rounded-xl border border-[#E5E3DE] bg-white overflow-hidden flex flex-col">
                <div className="aspect-[4/3] bg-[#EFECE6] overflow-hidden">
                  <StudioImage
                    src="/src/assets/images/limkokwing_sl_hall.jpg"
                    alt="Limkokwing University Sierra Leone students in the Freetown campus auditorium"
                    titleFallback="Limkokwing Sierra Leone Hall"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-6 flex-1">
                  <h3 className="font-display text-lg font-semibold text-[#141413]">
                    Personalized Brown Envelopes
                  </h3>
                  <p className="mt-2 text-sm text-[#57544E] leading-relaxed">
                    Upload straight from the campus lab or your phone—printed with your Name, Student ID, Department, Course, Lecturer, and Assignment Title.
                  </p>
                </div>
              </article>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#E5E3DE] bg-[#FAF9F7]">
        <div className="max-w-[1240px] mx-auto px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-sm text-[#57544E]">
          <div className="flex flex-wrap items-center gap-2">
            <BrandLogo size="sm" />
            <span aria-hidden="true">·</span>
            <span>Automated Student Printing &amp; Envelope Service</span>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <a href="#print-studio" className="hover:text-[#141413] transition-colors">
              Order Now
            </a>
            <a
              href="/track"
              onClick={(e) => {
                e.preventDefault();
                navigateToTrack();
              }}
              className="hover:text-[#141413] transition-colors"
            >
              Track Order
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
              Admin Dashboard
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
