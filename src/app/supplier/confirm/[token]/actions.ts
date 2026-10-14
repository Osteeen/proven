"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { allow } from "@/server/rate-limit";
import { answerConfirmation } from "@/server/suppliers/confirmations";

/**
 * The supplier answers from its emailed link. The link's token is the only
 * credential: it is single use, and only its hash is stored.
 */
export async function answerAction(token: string, formData: FormData): Promise<void> {
  const answer = formData.get("answer");
  if ((answer !== "confirmed" && answer !== "denied") || !allow(`supplier-confirm:${token.slice(0, 12)}`, 5, 60_000)) {
    redirect(`/supplier/confirm/${encodeURIComponent(token)}?r=invalid`);
  }
  const r = await answerConfirmation(token, answer);
  if (r === "done") {
    revalidatePath("/dashboard", "layout");
    revalidatePath("/review");
  }
  redirect(`/supplier/confirm/${encodeURIComponent(token)}?r=${r === "done" ? answer : r}`);
}
