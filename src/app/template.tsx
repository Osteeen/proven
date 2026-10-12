// Re-mounts on every navigation, so each page settles in instead of snapping.
// Plain CSS on purpose: it runs before JavaScript loads, so a slow connection
// never sees a blank page.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}
