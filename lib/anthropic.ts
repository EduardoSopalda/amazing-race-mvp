import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

/** Reads ANTHROPIC_API_KEY from the environment - set in Vercel like the other secrets. */
export function getAnthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}
