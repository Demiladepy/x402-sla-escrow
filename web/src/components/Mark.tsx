/** Four-shard chevron on a rounded plate. Gutters wide enough to read at 20px. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <rect width="64" height="64" rx="16" fill="#16308F" />
      <g transform="translate(-0.5 0)">
        <polygon fill="#F4F1E8" points="19,15.2 19,30.7 26.2,30.7 26.2,19.3" />
        <polygon fill="#F4F1E8" points="28.9,20.8 49,32 28.9,30.7" />
        <polygon fill="#F4F1E8" points="19,33.3 19,48.8 26.2,44.7 26.2,33.3" />
        <polygon fill="#F4F1E8" points="28.9,33.3 49,32 28.9,43.2" />
      </g>
    </svg>
  );
}
