// The loader for real waits: white dots running along the Moshboard m. Same markup and styles
// as the one in index.html (styles live there, so it can show before any script runs).
// It fades in only after the page has been loading for 300ms, so a quick load never shows it;
// when it takes over from index.html's copy, it shows right away and the two read as one.

const SHOW_AFTER = 300

export function Loader() {
  const delay = Math.max(0, SHOW_AFTER - performance.now())
  return (
    <div className="mb-loader" role="status" aria-label="Loading" style={{ '--mb-loader-delay': `${delay}ms` } as React.CSSProperties}>
      <div className="mb-loader-box">
        <svg className="mb-loader-base" viewBox="0 0 24 24" fill="none" aria-hidden>
          <g transform="translate(0 -0.9)" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.5 19.5V12a3.75 3.75 0 0 1 7.5 0v7.5" />
            <path d="M12 15.5V8a3.75 3.75 0 0 1 7.5 0V16" />
          </g>
        </svg>
        <div className="mb-loader-goo">
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <filter id="mb-goo">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" />
        </filter>
      </svg>
    </div>
  )
}
