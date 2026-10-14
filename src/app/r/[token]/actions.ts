"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { answerRecipient } from "@/server/proofs/recipients";
import { allow } from "@/server/rate-limit";

/** A recipient's answer from the texted link. The token is the only credential: single use, stored as a hash. */
export async function recipientAnswerAction(token: string, formData: FormData): Promise<void> {
  const answer = formData.get("answer");
  if ((answer !== "yes" && answer !== "no") || !allow(`recipient:${token.slice(0, 12)}`, 5, 60_000)) {
    redirect(`/r/${encodeURIComponent(token)}?e=1`);
  }
  const r = await answerRecipient(token, answer);
  if (r === "done") {
    revalidatePath("/dashboard", "layout");
    revalidatePath("/review");
  }
  redirect(`/r/${encodeURIComponent(token)}`);
}
