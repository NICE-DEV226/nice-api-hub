/**
 * NICE-API'HUB Logo Component
 * Author: NICE-DEV
 */

interface LogoProps {
  size?: number;
  className?: string;
}

export default function Logo({ size = 36, className = '' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Background rounded square */}
      <rect width="100" height="100" rx="20" fill="#E85D2D" />
      
      {/* Left vertical bar (i) */}
      <rect x="18" y="18" width="12" height="12" fill="#2D3748" />
      <rect x="18" y="38" width="12" height="44" fill="#2D3748" />
      
      {/* Middle horizontal bar */}
      <rect x="38" y="50" width="24" height="12" fill="#2D3748" />
      
      {/* Bottom left small square */}
      <rect x="38" y="70" width="12" height="12" fill="#2D3748" />
      
      {/* Right D shape - half circle */}
      <path
        d="M58 18 H70 C87 18 87 82 70 82 H58 V70 H70 C77 70 77 30 70 30 H58 V18Z"
        fill="#2D3748"
      />
      
      {/* Inner cutout of D */}
      <rect x="58" y="38" width="12" height="24" fill="#2D3748" />
    </svg>
  );
}

export function LogoIcon({ size = 24, className = '' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Background rounded square */}
      <rect width="100" height="100" rx="20" fill="#E85D2D" />
      
      {/* Left vertical bar (i) */}
      <rect x="18" y="18" width="12" height="12" fill="#1F2937" />
      <rect x="18" y="38" width="12" height="44" fill="#1F2937" />
      
      {/* Middle horizontal bar */}
      <rect x="38" y="50" width="24" height="12" fill="#1F2937" />
      
      {/* Bottom left small square */}
      <rect x="38" y="70" width="12" height="12" fill="#1F2937" />
      
      {/* Right D shape */}
      <path
        d="M58 18 H68 Q82 18 82 50 Q82 82 68 82 H58 V70 H66 Q70 70 70 50 Q70 30 66 30 H58 V18Z"
        fill="#1F2937"
      />
    </svg>
  );
}
