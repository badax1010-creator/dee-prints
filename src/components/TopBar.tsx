import React from 'react';
import { BrandLogo } from './BrandLogo';

interface TopBarProps {
  activeView?: 'home' | 'order' | 'track' | 'admin';
  onBackHome?: () => void;
  onStartOrder?: () => void;
  onOpenTrack?: () => void;
  onOpenAdmin?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeView = 'home',
  onBackHome,
  onStartOrder,
  onOpenTrack,
  onOpenAdmin,
}) => {
  const isSubView = activeView !== 'home';

  return (
    <header className="no-print sticky top-0 z-30 bg-[#FAF9F7]/95 backdrop-blur-sm border-b border-[#E5E3DE]">
      <div className="max-w-[1240px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
        <a
          href="/"
          onClick={(e) => {
            if (isSubView && onBackHome) {
              e.preventDefault();
              onBackHome();
            }
          }}
          className="whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#C8232C]"
        >
          <BrandLogo size="md" />
        </a>

        <nav
          aria-label="Primary"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-[#57544E]"
        >
          {!isSubView ? (
            <>
              <a
                href="#print-studio"
                className="hover:text-[#141413] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
              >
                Print Studio
              </a>
              <a
                href="#finishing-guide"
                className="hover:text-[#141413] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
              >
                Finishing Guide
              </a>
              <a
                href="#envelope-section"
                className="hover:text-[#141413] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
              >
                Envelope Label
              </a>
            </>
          ) : (
            <a
              href="/"
              onClick={(e) => {
                if (onBackHome) {
                  e.preventDefault();
                  onBackHome();
                }
              }}
              className="hover:text-[#141413] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Print Studio
            </a>
          )}
          {onOpenTrack && (
            <a
              href="/track"
              onClick={(e) => {
                e.preventDefault();
                onOpenTrack();
              }}
              className={`hover:text-[#141413] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
                activeView === 'track' ? 'text-[#141413] font-semibold underline' : ''
              }`}
            >
              Track Order
            </a>
          )}
          {onOpenAdmin && (
            <a
              href="/admin"
              onClick={(e) => {
                e.preventDefault();
                onOpenAdmin();
              }}
              className={`hover:text-[#141413] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
                activeView === 'admin' ? 'text-[#141413] font-semibold underline' : ''
              }`}
            >
              Admin
            </a>
          )}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          {isSubView && onBackHome ? (
            <button
              type="button"
              onClick={onBackHome}
              className="px-4 py-2 text-sm font-medium text-white bg-[#141413] rounded-lg hover:bg-[#2C2A27] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8232C]"
            >
              Back to Studio
            </button>
          ) : (
            <button
              type="button"
              onClick={onStartOrder}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#C8232C] rounded-lg hover:bg-[#AE1D25] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141413]"
            >
              Order Now
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
