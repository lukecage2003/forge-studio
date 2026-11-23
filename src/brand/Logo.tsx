/**
 * Forge mark: the "F" is a comic page layout — one tall panel and two
 * stacked panels separated by gutters — forged in ember.
 */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="forge-ember" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFB020" />
          <stop offset="0.55" stopColor="#FF5A1F" />
          <stop offset="1" stopColor="#E0301A" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="62" height="62" rx="15" fill="#141417" stroke="#2A2A31" strokeWidth="2" />
      <rect x="15" y="13" width="11" height="38" rx="2.5" fill="url(#forge-ember)" />
      <rect x="29" y="13" width="21" height="11" rx="2.5" fill="url(#forge-ember)" />
      <rect x="29" y="27" width="14" height="10" rx="2.5" fill="url(#forge-ember)" />
    </svg>
  );
}

export function Wordmark({ size = 28, tagline = true }: { size?: number; tagline?: boolean }) {
  return (
    <div className="wordmark">
      <Mark size={size} />
      <div className="wordmark-text">
        <span className="wordmark-name">FORGE</span>
        {tagline && <span className="wordmark-tag">Comic Motion Studio</span>}
      </div>
    </div>
  );
}
