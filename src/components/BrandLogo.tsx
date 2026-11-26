import React from 'react';

interface BrandLogoProps {
  size?: 'sm' | 'md';
  showWordmark?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  showWordmark = true,
}) => {
  const iconSize = size === 'sm' ? 'w-6 h-6' : 'w-7 h-7';
  const textSize = size === 'sm' ? 'text-base' : 'text-xl';

  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0">
      <svg
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className={`${iconSize} shrink-0`}
      >
        {/* Outer print sheet frame */}
        <path
          d="M5 4C5 2.89543 5.89543 2 7 2H19.5L27 9.5V28C27 29.1046 26.1046 30 25 30H7C5.89543 30 5 29.1046 5 28V4Z"
          fill="#141413"
        />
        {/* Folded corner accent in studio vermilion */}
        <path d="M19.5 2L27 9.5H21.5C20.3954 9.5 19.5 8.60457 19.5 7.5V2Z" fill="#C8232C" />
        {/* Bold geometric 'D' & print lines */}
        <path
          d="M10.5 12.5H14.5C17.2614 12.5 19.5 14.7386 19.5 17.5C19.5 20.2614 17.2614 22.5 14.5 22.5H10.5V12.5Z"
          stroke="#FAF9F7"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        <rect x="10.5" y="25" width="11" height="2" rx="1" fill="#C8232C" />
      </svg>
      {showWordmark && (
        <span className={`font-display ${textSize} font-bold tracking-tight text-[#141413]`}>
          DEE PRINTS
        </span>
      )}
    </span>
  );
};
