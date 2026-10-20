"use client";

import { useActionState, useState } from "react";
import { startRecipientCheckAction, type RecipientCheckState } from "./actions";

/**
 * After handing out the goods: the numbers recorded at intake go in, Proven
 * picks who is asked. The charity never learns who was picked.
 */
export function RecipientCheckForm({ needId }: { needId: string }) {
  const [state, action, pending] = useActionState<RecipientCheckState, FormData>(startRecipientCheckAction.bind(null, needId), {});
  const [numbers, setNumbers] = useState(state.numbers ?? "");
  const [consent, setConsent] = useState(false);
  const count = numbers.split(/[\n,;]+/).filter((l) => l.trim()).length;

  return (
    <form action={action} className="space-y-4 rounded-[10px] border border-line bg-card p-5" noValidate>
      <input type="hidden" name="numbers" value={numbers} />
      <input type="hidden" name="consent" value={consent ? "yes" : ""} />
      <div>
        <p className="text-sm font-medium text-ink">Recipient check</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          Once the goods are handed out, enter the phone numbers you recorded at intake. Proven texts a random few and asks if they received it - you won&apos;t know who. The numbers are deleted as soon as the texts go out.
        </p>
      </div>
      <div>
        <label htmlFor="recipient-numbers" className="text-sm font-medium text-ink">
          Phone numbers, one per line
        </label>
        <textarea
          id="recipient-numbers"
          value={numbers}
          onChange={(e) => setNumbers(e.target.value)}
          rows={5}
          autoComplete="off"
          spellCheck={false}
          placeholder={"+1 555 010 2233\n+1 555 010 4410"}
          className="mt-1.5 w-full rounded-md border border-line bg-card px-3 py-2.5 font-mono text-sm text-ink outline-none focus:border-ink focus:shadow-[0_0_0_3px_rgba(15,30,61,0.12)]"
        />
        <p className="mt-1 text-xs text-ink-muted">{count === 0 ? "Include the country code." : `${count.toLocaleString("en-US")} ${count === 1 ? "number" : "numbers"}`}</p>
      </div>
      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 accent-[#0f1e3d]" />
        <span>Each person agreed that Proven may text them once about this help when their number was recorded.</span>
      </label>
      {state.error && !pending && (
        <p role="alert" className="rise-in rounded-md border border-[#f09595] bg-[#fcebeb] px-4 py-3 text-sm text-[#791f1f]">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending || count === 0 || !consent} className="rounded-full bg-ink px-5 py-2.5 text-sm text-paper transition-[transform,opacity] active:scale-[0.97] disabled:opacity-40">
        {pending ? "Sending texts..." : "Send the recipient check"}
      </button>
    </form>
  );
}
