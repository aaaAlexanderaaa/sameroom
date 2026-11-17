export const BRAND_NAME = "共在";
export const BRAND_EN = "SameRoom";
export const BRAND_FULL = "共在 · SameRoom";
export const BRAND_TAGLINE = "人和个人 Agent 共处一室的 3D 生活空间";

export function SameRoomLogo({
  size = 26,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect width="64" height="64" rx="16" fill="#FAF8F2" />
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="14"
        stroke="#DCE2D4"
        strokeWidth="2.5"
      />
      <path
        d="M14 29L32 14L50 29V46C50 48.2091 48.2091 50 46 50H18C15.7909 50 14 48.2091 14 46V29Z"
        stroke="#263F37"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="27" cy="34" r="7" fill="#2E6B52" fillOpacity="0.92" />
      <circle cx="37.5" cy="34" r="7" fill="#C98834" fillOpacity="0.88" />
      <circle cx="32.25" cy="34" r="2.3" fill="#FAF8F2" />
    </svg>
  );
}
