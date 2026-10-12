// Shown while a page is being built on the server. The dashed half of the
// mark (money held) turns; the solid half and tick stay still.
export default function Loading() {
  return (
    <div className="loader flex min-h-[70vh] flex-col items-center justify-center gap-3" role="status" aria-live="polite">
      <svg viewBox="0 0 64 64" className="h-12 w-12" aria-hidden="true" focusable="false">
        <g className="loader-held">
          <path d="M32 8 A24 24 0 0 0 32 56" fill="none" stroke="#b26b00" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 7.5" />
        </g>
        <path d="M32 8 A24 24 0 0 1 32 56" fill="none" stroke="#1f7a4d" strokeWidth="5" strokeLinecap="round" />
        <path d="M20.5 33 L28.5 41 L44 23.5" fill="none" stroke="#0f1e3d" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="font-mono text-xs text-ink-muted">Loading</p>
    </div>
  );
}
