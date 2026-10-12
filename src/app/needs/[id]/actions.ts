"use server";

import { redirect } from "next/navigation";
import { DonationError, startDonation } from "@/server/donations/service";

export type DonateState = { error?: string; amount?: string };

async function start(needId: string, formData: FormData, topUpKey?: string): Promise<DonateState> {
  const amount = typeof formData.get("amount") === "string" ? (formData.get("amount") as string) : "";
  let approveUrl: string;
  try {
    approveUrl = await startDonation(needId, amount, topUpKey);
  } catch (e) {
    return { error: e instanceof DonationError ? e.message : "Something went wrong. Try again in a moment.", amount };
  }
  // Only ever a PayPal sandbox URL, built from PayPal's own response.
  if (!approveUrl.startsWith("https://www.sandbox.paypal.com/")) return { error: "PayPal returned an unexpected link.", amount };
  redirect(approveUrl);
}

export async function startDonationAction(needId: string, _prev: DonateState, formData: FormData): Promise<DonateState> {
  return start(needId, formData);
}

/** Adds another hold to a donor's existing gift. The key proves it's their gift. */
export async function startTopUpAction(key: string, needId: string, _prev: DonateState, formData: FormData): Promise<DonateState> {
  return start(needId, formData, key);
}
