import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/** Approved models (Osteen, Oct 9): Sonnet 5.5 for reasoning, Haiku 4.5 for fast checks. */
export const MODELS = { reasoning: "claude-sonnet-5-5", fast: "claude-haiku-4-5" } as const;

let client: Anthropic | undefined;

/** One shared client. The key comes from ANTHROPIC_API_KEY on the server only. */
export function claude(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new AiUnavailable("ANTHROPIC_API_KEY is not set");
  client ??= new Anthropic({ timeout: 90_000, maxRetries: 1 });
  return client;
}

/** The AI check couldn't run (missing key, network, refusal). The caller sends the proof to a person. */
export class AiUnavailable extends Error {}
