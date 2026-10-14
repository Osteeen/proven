"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCharity } from "@/server/auth/access";
import { parseNeedInput, type FieldErrors } from "@/server/needs/input";
import { NeedLimitError, createNeed } from "@/server/needs/repo";

export type NeedFormState = {
  errors?: FieldErrors & { form?: string };
  values?: { title: string; description: string; amount: string; deadline: string; fundingModel: string; requiredProof: string[] };
};

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

export async function createNeedAction(_prev: NeedFormState, formData: FormData): Promise<NeedFormState> {
  // The charity comes from the session only - nothing in the form can choose it.
  const ctx = await requireCharity();
  const values = {
    title: str(formData.get("title")),
    description: str(formData.get("description")),
    amount: str(formData.get("amount")),
    deadline: str(formData.get("deadline")),
    fundingModel: str(formData.get("fundingModel")),
    requiredProof: formData.getAll("requiredProof").filter((v): v is string => typeof v === "string"),
  };
  const parsed = parseNeedInput(values, { now: new Date() });
  if (!parsed.ok) return { errors: parsed.errors, values };

  let id: string;
  try {
    id = await createNeed(ctx, parsed.value);
  } catch (e) {
    if (e instanceof NeedLimitError) return { errors: { form: e.message }, values };
    return { errors: { form: "Couldn't save the need. Check the details and try again." }, values };
  }
  revalidatePath("/");
  revalidatePath("/dashboard");
  redirect(`/dashboard?posted=${id}`);
}
