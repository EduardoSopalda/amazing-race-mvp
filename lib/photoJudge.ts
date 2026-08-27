import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropicClient } from "./anthropic";

const JudgementSchema = z.object({
  verdict: z.enum(["correct", "incorrect", "ambiguous"]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export interface PhotoJudgement {
  verdict: "correct" | "incorrect" | "ambiguous";
  confidence: number;
  reason: string;
}

/**
 * Grades a submitted photo against a checkpoint's written spec (doc §5): a
 * vision model returns correct/incorrect/ambiguous, a confidence score, and
 * a short reason. "Ambiguous" is a genuine outcome, not a fallback - the
 * model is told explicitly not to guess when it isn't confident. AI never
 * has final say on ambiguous cases (doc §5, §9); see RaceEngine.resolveAttempt.
 */
export async function judgePhoto(params: {
  imageBase64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  instruction: string;
  aiCriteria: string[];
}): Promise<PhotoJudgement> {
  const client = getAnthropicClient();

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 1024,
    system:
      "You are judging a single photo submitted for a scavenger-hunt checkpoint in a team-building race. " +
      "Grade strictly against the stated criteria - every required element must be clearly visible in the " +
      "frame. Use 'ambiguous' when the photo is genuinely unclear, low quality, or only partially meets the " +
      "criteria - do not guess correct or incorrect when you are not confident.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: params.mediaType, data: params.imageBase64 },
          },
          {
            type: "text",
            text:
              `Challenge instruction: "${params.instruction}"\n\n` +
              "Required criteria (all must be met):\n" +
              params.aiCriteria.map((c) => `- ${c}`).join("\n") +
              "\n\nDoes this photo satisfy the challenge?",
          },
        ],
      },
    ],
    output_config: {
      format: zodOutputFormat(JudgementSchema),
    },
  });

  if (!response.parsed_output) {
    // Structured parsing failed - treat as ambiguous rather than silently guessing.
    return { verdict: "ambiguous", confidence: 0, reason: "Could not parse the AI judgement." };
  }
  return response.parsed_output;
}
