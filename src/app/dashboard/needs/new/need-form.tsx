"use client";

import { useActionState } from "react";
import { ProofPicker, SlidingChoice } from "@/components/motion/choices";
import { DatePicker } from "@/components/motion/date-picker";
import { MoneyInput } from "@/components/money-input";
import { createNeedAction, type NeedFormState } from "./actions";

// The PayPal supplier payment comes first and is always required; the rest are second checks.
const PROOFS = [
  { value: "supplier_paypal_payment", label: "Paid the supplier with PayPal", hint: "Pay the supplier through Proven. PayPal's payment record is the main proof." },
  { value: "receipt", label: "Receipt", hint: "Read by AI and matched to the need" },
  { value: "supplier_confirmation", label: "Supplier confirms", hint: "We ask the supplier at the email PayPal has on file." },
  { value: "recipient_confirmation", label: "Recipient confirms", hint: "We text a random sample of the people helped" },
];

const field =
  "mt-1.5 w-full rounded-md border border-line bg-card px-3 py-2.5 text-ink transition-[border-color,box-shadow] duration-(--duration-quick) outline-none focus:border-ink focus:shadow-[0_0_0_3px_rgba(15,30,61,0.12)]";

function Err({ msg, id }: { msg?: string; id: string }) {
  if (!msg) return null;
  return (
    <p id={id} className="rise-in mt-1.5 text-sm text-[#a32d2d]">
      {msg}
    </p>
  );
}

export function NeedForm({ minDate, maxDate, today }: { minDate: string; maxDate: string; today: string }) {
  const [state, action, pending] = useActionState<NeedFormState, FormData>(createNeedAction, {});
  const v = state.values;
  const e = state.errors ?? {};

  return (
    <form action={action} className="space-y-7" noValidate>
      {e.form && (
        <p role="alert" className="rounded-md border border-[#f09595] bg-[#fcebeb] px-4 py-3 text-sm text-[#791f1f]">
          {e.form}
        </p>
      )}

      <div>
        <label htmlFor="title" className="text-sm font-medium text-ink">What is needed</label>
        <input id="title" name="title" defaultValue={v?.title} placeholder="50 blankets for Riverbend shelter" className={field} aria-invalid={!!e.title} aria-describedby="title-err" />
        <Err msg={e.title} id="title-err" />
      </div>

      <div>
        <label htmlFor="description" className="text-sm font-medium text-ink">Who it helps and how</label>
        <textarea
          id="description"
          name="description"
          rows={4}
          defaultValue={v?.description}
          placeholder="Fleece blankets for the 50 families sleeping at the school gym after the flood."
          className={field}
          aria-invalid={!!e.description}
          aria-describedby="description-err"
        />
        <Err msg={e.description} id="description-err" />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="amount" className="text-sm font-medium text-ink">Cost (USD)</label>
          <div className="mt-1.5">
            <MoneyInput id="amount" name="amount" defaultValue={v?.amount} placeholder="500" invalid={!!e.amount} describedBy="amount-help amount-err" />
          </div>
          <p id="amount-help" className="mt-1.5 text-xs text-ink-muted">Donors pay only what you prove you spent.</p>
          <Err msg={e.amount} id="amount-err" />
        </div>
        <div>
          <span className="text-sm font-medium text-ink">Deliver by</span>
          <DatePicker name="deadline" label="Deliver by" min={minDate} max={maxDate} today={today} defaultValue={v?.deadline} invalid={!!e.deadline} describedBy="deadline-help deadline-err" />
          <p id="deadline-help" className="mt-1.5 text-xs text-ink-muted">Within 28 days - PayPal holds money for 29.</p>
          <Err msg={e.deadline} id="deadline-err" />
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-ink">Proof you&apos;ll provide</legend>
        <p className="mt-0.5 text-xs text-ink-muted">Buy through Proven and pay the supplier with PayPal. Add at least one second check - you get paid only when both agree.</p>
        <ProofPicker name="requiredProof" options={PROOFS} required="supplier_paypal_payment" defaultValues={v?.requiredProof} />
        <Err msg={e.requiredProof} id="proof-err" />
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium text-ink">When you get paid</legend>
        <SlidingChoice
          name="fundingModel"
          layoutId="funding-model"
          defaultValue={v?.fundingModel || "reimbursement"}
          options={[
            { value: "reimbursement", label: "After delivery", hint: "All of it, once delivery is proven" },
            { value: "staged", label: "Part on booking, rest on delivery", hint: "For charities that can't pay up front" },
          ]}
        />
        <Err msg={e.fundingModel} id="model-err" />
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-ink px-6 py-3 text-sm text-paper transition-[transform,opacity] duration-(--duration-quick) ease-(--ease-out-soft) active:scale-[0.98] disabled:opacity-60"
      >
        {pending ? "Posting..." : "Post need"}
      </button>
    </form>
  );
}
