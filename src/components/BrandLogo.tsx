import React from 'react';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  hideText?: boolean;
  hideTextOnMobile?: boolean;
  stacked?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  hideText = false,
  hideTextOnMobile = false,
  stacked = false,
}) => {
  const iconSize =
    size === 'lg'
      ? 'h-20 w-20 rounded-2xl'
      : size === 'sm'
      ? 'h-8 w-8 sm:h-9 sm:w-9 rounded-xl'
      : 'h-10 w-10 rounded-xl';

  const titleSize =
    size === 'lg'
      ? 'text-3xl sm:text-4xl'
      : size === 'sm'
      ? 'text-sm sm:text-base'
      : 'text-base sm:text-lg';

  return (
    <div
      className={`inline-flex items-center ${
        stacked ? 'flex-col gap-3.5 text-center' : 'gap-2.5 text-left'
      }`}
    >
      <img
        src={size === 'lg' ? './icon-512.png' : './icon-192.png'}
        alt="Qualiadept Stream"
        className={`${iconSize} flex-shrink-0 object-cover ring-1 ring-white/15 shadow-lg shadow-fuchsia-600/30`}
      />
      {!hideText && (
        <div
          className={`flex items-center gap-1.5 leading-none ${
            hideTextOnMobile ? 'hidden sm:inline-flex' : 'inline-flex'
          }`}
        >
          <span className={`${titleSize} font-black tracking-tight text-white`}>
            QUALIADEPT
          </span>
          <span
            className={`${
              size === 'lg'
                ? 'text-sm sm:text-base px-2.5 py-1'
                : 'text-[10px] sm:text-xs px-1.5 py-0.5'
            } rounded-md bg-gradient-to-r from-sky-400 via-violet-500 to-fuchsia-500 font-black uppercase tracking-widest text-white shadow-sm shadow-violet-600/40`}
          >
            STREAM
          </span>
        </div>
      )}
    </div>
  );
};
