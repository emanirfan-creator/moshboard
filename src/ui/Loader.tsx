// The loader for real waits: a bright stretch of stroke running along the Moshboard m. Same markup and styles
// as the one in index.html (styles live there, so it can show before any script runs).
// It fades in only after the page has been loading for 300ms, so a quick load never shows it;
// when it takes over from index.html's copy, it shows right away and the two read as one.

const SHOW_AFTER = 300

export function Loader() {
  const delay = Math.max(0, SHOW_AFTER - performance.now())
  return (
    <div className="mb-loader" role="status" aria-label="Loading" style={{ '--mb-loader-delay': `${delay}ms` } as React.CSSProperties}>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <g transform="translate(0 -0.9)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
          <path className="mb-loader-base" d="M4.5 19.5V12a3.75 3.75 0 0 1 7.5 0v7.5" />
          <path className="mb-loader-base" d="M12 15.5V8a3.75 3.75 0 0 1 7.5 0V16" />
          <path className="mb-loader-run" pathLength={100} d="M4.5 19.5V12a3.75 3.75 0 0 1 7.5 0v7.5V8a3.75 3.75 0 0 1 7.5 0V16" />
        </g>
      </svg>
    </div>
  )
}
