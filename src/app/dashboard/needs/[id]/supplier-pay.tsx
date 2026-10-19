"use client";

import { AnimatePresence, motion } from "motion/react";
import { useActionState, useEffect, useState, useTransition } from "react";
import { MoneyInput } from "@/components/money-input";
import { Select } from "@/components/motion/select";
import { formatUsd } from "@/server/money";
import type { SupplierView } from "@/server/suppliers/service";
import { checkSupplierAction, checkSupplierPaymentAction, inviteSupplierAction, paySupplierAction, type InviteSupplierState, type PaySupplierState } from "./actions";

export type SupplierOption = SupplierView;

const FIELD = "mt-1.5 w-full rounded-md border border-line bg-card px-3 py-2.5 text-ink outline-none focus:border-ink focus:shadow-[0_0_0_3px_rgba(15,30,61,0.12)]";
const ERROR = "rise-in rounded-md border border-[#f09595] bg-[#fcebeb] px-4 py-3 text-sm text-[#791f1f]";

/** The name PayPal holds for the account, when it differs from the name the charity typed - a look-alike shows up here. */
function paypalNameNote(s: SupplierOption): string | null {
  if (!s.paypalName || s.paypalName === s.name) return null;
  return `Name on PayPal: ${s.paypalName}${s.country ? ` (${s.country})` : ""}`;
}

export function SupplierPay({ needId, suppliers, remainingCents, canPay }: { needId: string; suppliers: SupplierOption[]; remainingCents: number; canPay: boolean }) {
  const connected = suppliers.filter((s) => s.status === "connected");
  const invited = suppliers.filter((s) => s.status !== "connected");
  const [inviting, setInviting] = useState(connected.length === 0);

  return (
    <div className="space-y-4">
      {canPay && connected.length > 0 && <PayForm needId={needId} suppliers={connected} remainingCents={remainingCents} />}
      {canPay && connected.length === 0 && !inviting && (
        <p className="text-sm text-ink-muted">No supplier has connected PayPal yet.</p>
      )}

      {invited.length > 0 && (
        <ul className="space-y-2">
          {invited.map((s) => (
            <InvitedRow key={s.id} needId={needId} supplier={s} />
          ))}
        </ul>
      )}

      {inviting ? (
        <InviteForm needId={needId} onClose={connected.length > 0 ? () => setInviting(false) : undefined} />
      ) : (
        <button type="button" onClick={() => setInviting(true)} className="text-sm text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
          Supplier not listed? Invite them to connect PayPal
        </button>
      )}
    </div>
  );
}

function PayForm({ needId, suppliers, remainingCents }: { needId: string; suppliers: SupplierOption[]; remainingCents: number }) {
  const [state, action, pending] = useActionState<PaySupplierState, FormData>(paySupplierAction.bind(null, needId), {});
  const [supplierId, setSupplierId] = useState(state.supplierId ?? suppliers[0]!.id);
  const [amount, setAmount] = useState(state.amount ?? "");
  const [description, setDescription] = useState(state.description ?? "");
  const leaving = Boolean(state.approveUrl);
  // The repeat question shows for this answer only; changing the form or saying no clears it.
  const [repeatDismissed, setRepeatDismissed] = useState(false);
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    setRepeatDismissed(false);
  }
  const repeatAsked = Boolean(state.repeat) && !repeatDismissed && !pending;
  const chosen = suppliers.find((s) => s.id === supplierId);

  useEffect(() => {
    if (state.approveUrl) window.location.assign(state.approveUrl);
  }, [state.approveUrl]);

  return (
    <form action={action} className="space-y-4 rounded-[10px] border border-line bg-card p-5" noValidate>
      {/* Values come from state, not the DOM: a failed submit must not lose them. */}
      <input type="hidden" name="supplierId" value={supplierId} />
      <input type="hidden" name="description" value={description} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <span className="text-sm font-medium text-ink">Supplier</span>
          <div className="mt-1.5">
            <Select label="Supplier" value={supplierId} onChange={setSupplierId} field options={suppliers.map((s) => ({ value: s.id, label: s.verified ? s.name : `${s.name} (not verified yet)` }))} />
          </div>
          {chosen && paypalNameNote(chosen) && <p className="mt-1 text-xs text-ink-muted">{paypalNameNote(chosen)}</p>}
          {chosen && !chosen.verified && (
            <p className="mt-1 text-xs text-review-text">Proven hasn&apos;t verified this business yet. A reviewer checks it once - until then, payments to it go to review.</p>
          )}
        </div>
        <div>
          <label htmlFor="supplier-amount" className="text-sm font-medium text-ink">
            Amount
          </label>
          <div className="mt-1.5">
            <MoneyInput id="supplier-amount" name="amount" value={amount} onChange={setAmount} placeholder="1250.00" />
          </div>
          <p className="mt-1 text-xs text-ink-muted">Up to {formatUsd(remainingCents)} left on this need.</p>
        </div>
      </div>
      <div>
        <label htmlFor="supplier-desc" className="text-sm font-medium text-ink">
          What you&apos;re buying
        </label>
        <input id="supplier-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={120} placeholder="50 fleece blankets" className={FIELD} />
      </div>
      {state.error && !pending && (
        <p role="alert" className={ERROR}>
          {state.error}
        </p>
      )}
      {repeatAsked ? (
        // Asked in place, in this form: the same payment again is usually a mistake.
        <div role="alert" className="rise-in space-y-3 rounded-md border border-held/40 bg-held-bg px-4 py-3 text-sm text-held-text">
          <p>{state.repeat} Pay again?</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" name="confirmRepeat" value="1" disabled={pending || leaving} className="rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-40">
              {leaving ? "Opening PayPal..." : pending ? "Starting payment..." : "Yes, pay again"}
            </button>
            <button type="button" onClick={() => setRepeatDismissed(true)} disabled={pending || leaving} className="text-sm underline underline-offset-4">
              No, don&apos;t pay
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" disabled={pending || leaving} className="rounded-full bg-ink px-5 py-2.5 text-sm text-paper transition-[transform,opacity] active:scale-[0.97] disabled:opacity-40">
            {leaving ? "Opening PayPal..." : pending ? "Starting payment..." : "Pay with PayPal"}
          </button>
          <p className="min-w-0 flex-1 text-xs text-ink-muted">You approve it on PayPal from your charity&apos;s own account. The money goes to the supplier, not to Proven.</p>
        </div>
      )}
    </form>
  );
}

function InviteForm({ needId, onClose }: { needId: string; onClose?: () => void }) {
  const [state, action, pending] = useActionState<InviteSupplierState, FormData>(inviteSupplierAction.bind(null, needId), {});
  const [name, setName] = useState(state.name ?? "");
  const [email, setEmail] = useState(state.email ?? "");

  return (
    <form action={action} className="space-y-4 rounded-[10px] border border-dashed border-line p-5" noValidate>
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="email" value={email} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink">Invite a supplier</p>
          <p className="mt-0.5 text-xs text-ink-muted">They connect their PayPal business account once - no Proven account. Then any charity on Proven can pay them.</p>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="shrink-0 text-xs text-ink-muted underline underline-offset-4 hover:text-ink">
            Close
          </button>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="supplier-name" className="text-sm font-medium text-ink">
            Business name
          </label>
          <input id="supplier-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Valley Supply Co." className={FIELD} />
        </div>
        <div>
          <label htmlFor="supplier-email" className="text-sm font-medium text-ink">
            Their PayPal business email
          </label>
          <input id="supplier-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} placeholder="sales@valleysupply.example" className={FIELD} />
        </div>
      </div>
      <AnimatePresence initial={false}>
        {state.error && !pending ? (
          <motion.p key="err" role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={ERROR}>
            {state.error}
          </motion.p>
        ) : state.sent && !pending ? (
          <motion.p key="ok" role="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-md border border-proven/30 bg-proven-bg px-4 py-3 text-sm text-proven-text">
            {state.sent === "connected" ? "That supplier is already connected - pick them above." : "Invite sent. Once they connect PayPal, they show up above."}
          </motion.p>
        ) : null}
      </AnimatePresence>
      <button type="submit" disabled={pending} className="rounded-full border border-ink px-5 py-2 text-sm text-ink transition-[transform,opacity] active:scale-[0.97] disabled:opacity-40">
        {pending ? "Sending invite..." : "Send invite"}
      </button>
    </form>
  );
}

function InvitedRow({ needId, supplier }: { needId: string; supplier: SupplierOption }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="rounded-[10px] border border-line bg-card px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="text-ink">{supplier.name}</span>
          {supplier.email && <span className="ml-2 text-xs text-ink-muted">{supplier.email}</span>}
          <span className="block text-xs text-ink-muted">
            {supplier.status === "rejected" ? "Not accepted - Proven couldn't confirm this is an independent business" : "Invited - waiting for them to connect PayPal"}
          </span>
        </span>
        {supplier.status === "invited" && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await checkSupplierAction(needId, supplier.id);
              if (r.error) setError(r.error);
            })
          }
          className="rounded-full border border-line px-3 py-1.5 text-xs text-ink hover:border-ink disabled:opacity-40"
        >
          {pending ? "Checking..." : "Check again"}
        </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-[#791f1f]">{error}</p>}
    </li>
  );
}

/** For a payment the charity approved but didn't come back from: asks PayPal and finishes it. */
export function CheckPaymentButton({ needId, paymentId }: { needId: string; paymentId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await checkSupplierPaymentAction(needId, paymentId);
            if (r.error) setError(r.error);
          })
        }
        className="rounded-full border border-line px-3 py-1.5 text-xs text-ink hover:border-ink disabled:opacity-40"
      >
        {pending ? "Checking..." : "Check PayPal"}
      </button>
      {error && <span className="max-w-[16rem] text-right text-xs text-[#791f1f]">{error}</span>}
    </span>
  );
}
