import React from 'react';
import brandLogo from '../assets/brand-logo.png';

type BrandLogoProps = {
  className?: string;
  /** pixel size for square mark */
  size?: number;
  alt?: string;
};

/** Scales of justice mark — bundled so browsers cannot keep the old icon */
export const BrandLogo = React.memo(({ className = '', size = 40, alt = 'casemate' }: BrandLogoProps) => (
  <img
    src={brandLogo}
    width={size}
    height={size}
    alt={alt}
    className={`object-contain select-none ${className}`}
    draggable={false}
    decoding="async"
  />
));
