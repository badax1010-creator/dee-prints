import React, { useState } from 'react';
import { Printer } from 'lucide-react';

interface StudioImageProps {
  src: string;
  alt: string;
  titleFallback: string;
  className?: string;
}

export const StudioImage: React.FC<StudioImageProps> = ({
  src,
  alt,
  titleFallback,
  className = '',
}) => {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-[#EFECE6] text-[#57544E] p-6 text-center ${className}`}
      >
        <Printer className="w-8 h-8 mb-2 text-[#141413]" />
        <p className="font-display text-sm font-semibold text-[#141413]">
          {titleFallback}
        </p>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
};
