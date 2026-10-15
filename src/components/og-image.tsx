import { ImageResponse } from "next/og";

/** Link-preview images (Open Graph / X): 1200 x 630, Proven's paper, ink and stamps. */
export const OG_SIZE = { width: 1200, height: 630 };

const INK = "#0f1e3d";
const SOFT = "#4a5571";
const PAPER = "#f7f5ef";
const HELD = "#b26b00";
const PROVEN = "#1f7a4d";

/**
 * One Google font, fetched with just the letters this image uses. Fraunces sets the
 * wordmark and headline, Inter everything else; each face is told exactly which text
 * it covers, so the two never mix inside a line. If a fetch fails, that text falls
 * back to the default face and the image still renders.
 */
async function googleFont(family: string, text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (
      await fetch(`https://fonts.googleapis.com/css2?family=${family}&text=${encodeURIComponent(text)}`, { signal: AbortSignal.timeout(4000) })
    ).text();
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
    if (!url) return null;
    return await (await fetch(url, { signal: AbortSignal.timeout(4000) })).arrayBuffer();
  } catch {
    return null;
  }
}

function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <path d="M32 8 A24 24 0 0 0 32 56" fill="none" stroke={HELD} strokeWidth="5" strokeLinecap="round" strokeDasharray="2 7.5" />
      <path d="M32 8 A24 24 0 0 1 32 56" fill="none" stroke={PROVEN} strokeWidth="5" strokeLinecap="round" />
      <path d="M20.5 33 L28.5 41 L44 23.5" fill="none" stroke={INK} strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Stamp({ color, children }: { color: string; children: string }) {
  return (
    <div style={{ display: "flex", border: `3px solid ${color}`, color, borderRadius: 8, padding: "6px 16px", fontSize: 24, fontWeight: 700, letterSpacing: 2 }}>
      {children}
    </div>
  );
}

/** The shared layout: wordmark, an eyebrow, a big headline, a detail line, and Held -> Proven. */
export async function ogImage({ eyebrow, headline, detail }: { eyebrow: string; headline: string; detail: string }) {
  const [display, body] = await Promise.all([
    googleFont("Fraunces:opsz,wght@144,600", `Proven${headline}`),
    googleFont("Inter:wght@500", `${eyebrow.toUpperCase()}${detail}HELD BY PAYPALPROVEN→PayPal sandbox demo`),
  ]);
  const serif = display ? "Fraunces" : undefined;
  const fonts = [
    ...(display ? [{ name: "Fraunces", data: display, weight: 600 as const, style: "normal" as const }] : []),
    ...(body ? [{ name: "Inter", data: body, weight: 500 as const, style: "normal" as const }] : []),
  ];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: PAPER, color: INK, padding: "64px 72px", fontFamily: body ? "Inter" : undefined }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Mark size={64} />
          <div style={{ display: "flex", fontSize: 44, fontFamily: serif, fontWeight: 600 }}>Proven</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "flex", fontSize: 26, color: SOFT, letterSpacing: 3 }}>{eyebrow.toUpperCase()}</div>
          <div style={{ display: "flex", fontSize: headline.length > 70 ? 54 : 64, lineHeight: 1.1, fontFamily: serif, fontWeight: 600, maxWidth: 1040 }}>{headline}</div>
          <div style={{ display: "flex", fontSize: 28, color: SOFT, maxWidth: 1056 }}>{detail}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Stamp color={HELD}>HELD BY PAYPAL</Stamp>
            <div style={{ display: "flex", fontSize: 32, color: SOFT }}>→</div>
            <Stamp color={PROVEN}>PROVEN</Stamp>
          </div>
          <div style={{ display: "flex", fontSize: 22, color: SOFT }}>PayPal sandbox demo</div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: fonts.length ? fonts : undefined },
  );
}
