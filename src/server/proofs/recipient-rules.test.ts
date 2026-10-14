import { describe, expect, it } from "vitest";
import { maskPhone, normalizePhone, parseRecipients, recipientStatus, sampleSize, yesNeeded } from "./recipient-rules";

describe("phone numbers", () => {
  it.each([
    ["+1 (555) 010-2233", "+15550102233"],
    ["00234 803 123 4567", "+2348031234567"],
    ["+234.803.123.4567", "+2348031234567"],
  ])("normalises %s", (raw, want) => expect(normalizePhone(raw)).toBe(want));

  it.each(["12345", "call me", "0803 123 4567", "15550102233", "+1 555 010 2233 ext 4", "+1234567890123456", "=HYPERLINK(1)"])("refuses %s", (raw) =>
    expect(normalizePhone(raw)).toBeNull(),
  );

  it("counts one handset once, however it's written", () => {
    const r = parseRecipients("+1 555 010 2233\n+15550102233, 001 555 010 2233;\n\nnope");
    expect(r.numbers).toEqual(["+15550102233"]);
    expect(r.invalid).toBe(1);
  });

  it("masks all but the last four digits", () => expect(maskPhone("+15550102233")).toBe("+•••••••2233"));
});

describe("sample size", () => {
  it.each([
    [1, 1],
    [3, 3],
    [4, 3],
    [40, 4],
    [500, 10],
  ])("asks %i -> %i", (n, k) => expect(sampleSize(n)).toBe(k));
  it("needs half the sample to say yes", () => {
    expect(yesNeeded(1)).toBe(1);
    expect(yesNeeded(3)).toBe(2);
    expect(yesNeeded(10)).toBe(5);
  });
});

describe("recipient proof status", () => {
  const base = { sample: 3, total: 30, yes: 0, no: 0, sharedNumbers: 0, expired: false };
  it("keeps checking until half say yes", () => {
    expect(recipientStatus({ ...base, yes: 1 }).status).toBe("checking");
    expect(recipientStatus({ ...base, yes: 2 }).status).toBe("passed");
  });
  it("sends any no to a person", () => {
    expect(recipientStatus({ ...base, yes: 2, no: 1 }).status).toBe("needs_review");
  });
  it("sends numbers shared with another charity's need to a person, without telling the charity why", () => {
    const r = recipientStatus({ ...base, yes: 3, sharedNumbers: 2 });
    expect(r.status).toBe("needs_review");
    expect(r.reasons.join(" ")).not.toMatch(/another charity|shared|also given/);
  });
  it("never lets a tiny list pass on its own", () => {
    expect(recipientStatus({ ...base, sample: 1, total: 1, yes: 1 }).status).toBe("needs_review");
    expect(recipientStatus({ ...base, sample: 3, total: 5, yes: 2 }).status).toBe("passed");
  });
  it("shows nothing different while a shared list is still being answered", () => {
    expect(recipientStatus({ ...base, sharedNumbers: 3 })).toEqual(recipientStatus(base));
  });
  it("sends a check that ran out of time to a person", () => {
    expect(recipientStatus({ ...base, yes: 1, expired: true }).status).toBe("needs_review");
  });
});
