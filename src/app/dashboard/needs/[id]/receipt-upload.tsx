"use client";

import { AnimatePresence, motion } from "motion/react";
import { startTransition, useActionState, useRef, useState } from "react";
import { uploadReceiptAction, type ReceiptUploadState } from "./actions";

const MAX_SIDE = 1600;

/** Shrinks a photo to at most 1600px on the long side as JPEG: faster upload, cheaper and quicker AI read. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file; // Unknown format in this browser: send as is, the server checks it.
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.88));
}

const RESULT: Record<string, { tone: string; title: string }> = {
  passed: { tone: "border-proven/30 bg-proven-bg text-proven-text", title: "Receipt checked - it matches the need." },
  needs_review: { tone: "border-review/30 bg-review-bg text-review-text", title: "Receipt saved - a person will check it." },
  failed: { tone: "border-[#f09595] bg-[#fcebeb] text-[#791f1f]", title: "This receipt didn't pass the check." },
};

export function ReceiptUpload({ needId }: { needId: string }) {
  const [state, action, pending] = useActionState<ReceiptUploadState, FormData>(uploadReceiptAction.bind(null, needId), {});
  const [preview, setPreview] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const choose = async (file: File | undefined) => {
    setLocalError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setLocalError("Choose a photo of the receipt (JPEG, PNG or WebP).");
      return;
    }
    const blob = await shrink(file);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(blob);
    });
    const fd = new FormData();
    fd.set("receipt", new File([blob], "receipt.jpg", { type: blob.type || file.type }));
    startTransition(() => action(fd));
    if (input.current) input.current.value = "";
  };

  const result = state.result ? RESULT[state.result.status] : undefined;
  const error = localError ?? state.error;

  return (
    <div>
      <input
        ref={input}
        id="receipt-file"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        className="sr-only"
        disabled={pending}
        onChange={(e) => void choose(e.target.files?.[0])}
      />
      <label
        htmlFor="receipt-file"
        aria-disabled={pending}
        className={`flex cursor-pointer items-center gap-4 rounded-[10px] border border-dashed px-4 py-4 transition-colors ${pending ? "cursor-wait border-review/40 bg-review-bg/50" : "border-line bg-card hover:border-ink-muted"}`}
      >
        <span className="relative flex h-14 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[4px] border border-line bg-[#fbfaf6]">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local preview of the photo being uploaded
            <img src={preview} alt="" className="h-full w-full object-cover" />
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-ink-muted" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z" />
              <path d="M9 8h6M9 12h6M9 16h3" />
            </svg>
          )}
          {pending && (
            <motion.span
              className="absolute inset-x-0 h-[2px] bg-review"
              initial={{ top: "0%" }}
              animate={{ top: ["0%", "100%", "0%"] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              aria-hidden="true"
            />
          )}
        </span>
        <span className="min-w-0">
          <span className="block text-sm text-ink">{pending ? "Reading the receipt..." : "Upload a receipt"}</span>
          <span className="block text-xs text-ink-muted">
            {pending ? "Checking the shop, items, date, and total against this need." : "A clear photo of the whole receipt. AI reads it; a person checks anything unclear."}
          </span>
        </span>
      </label>

      <AnimatePresence mode="wait">
        {error && !pending && (
          <motion.p key="err" role="alert" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 rounded-md border border-[#f09595] bg-[#fcebeb] px-4 py-3 text-sm text-[#791f1f]">
            {error}
          </motion.p>
        )}
        {result && !pending && !error && (
          <motion.div key="res" role="status" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`mt-3 rounded-md border px-4 py-3 text-sm ${result.tone}`}>
            <p className="font-medium">{result.title}</p>
            {state.result!.reasons.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px]">
                {state.result!.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
