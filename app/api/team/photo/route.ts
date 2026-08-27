import { NextRequest, NextResponse } from "next/server";
import { uploadPhoto } from "@/lib/blobStore";
import { judgePhoto } from "@/lib/photoJudge";
import { withEngine } from "@/lib/raceStore";
import { TEAM_COOKIE } from "@/lib/session";
import { buildTeamStatePayload } from "@/lib/teamState";
import { SELF_CHECKED_TYPES } from "@/game/types";

const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB - photos should already be compressed client-side

export async function POST(request: NextRequest) {
  const teamId = request.cookies.get(TEAM_COOKIE)?.value;
  if (!teamId) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }

  let body: { imageBase64?: unknown; mediaType?: unknown; idempotencyKey?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : null;
  const mediaType = typeof body.mediaType === "string" ? body.mediaType : null;
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined;
  if (!imageBase64 || !mediaType) {
    return NextResponse.json({ error: "imageBase64 and mediaType are required" }, { status: 400 });
  }
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
    return NextResponse.json({ error: "mediaType must be image/jpeg, image/png, or image/webp" }, { status: 400 });
  }

  const buffer = Buffer.from(imageBase64, "base64");
  if (buffer.byteLength === 0) {
    return NextResponse.json({ error: "Empty image" }, { status: 400 });
  }
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image too large - please retake at a lower quality" }, { status: 413 });
  }

  return withEngine(async (engine) => {
    let checkpoint;
    try {
      checkpoint = engine.currentCheckpoint(teamId);
    } catch {
      return NextResponse.json({ error: "Unknown team" }, { status: 404 });
    }
    if (!checkpoint) {
      return NextResponse.json({ error: "Team has already finished" }, { status: 400 });
    }
    if (SELF_CHECKED_TYPES.has(checkpoint.challengeType)) {
      return NextResponse.json(
        { error: `Checkpoint ${checkpoint.checkpoint} is challengeType "${checkpoint.challengeType}"; use /api/team/submit` },
        { status: 400 }
      );
    }
    if (engine.currentUnlockedAtMs(teamId) === null) {
      return NextResponse.json(
        { error: `Checkpoint ${checkpoint.checkpoint} has not been reached yet - GPS must confirm arrival first` },
        { status: 400 }
      );
    }

    // A retried request for the exact same submission (Phase 7's backoff, or
    // a manual "Retry upload") replays the original outcome instead of
    // paying for a second AI judging call on a photo already judged.
    const cached = engine.checkIdempotentSubmission(teamId, idempotencyKey);
    if (cached) {
      return NextResponse.json({
        result: cached.result,
        judgement: cached.extra?.judgement ?? null,
        photoUrl: cached.photoUrl ?? null,
        state: buildTeamStatePayload(engine, teamId),
      });
    }

    let judgement;
    try {
      judgement = await judgePhoto({
        imageBase64,
        mediaType: mediaType as "image/jpeg" | "image/png" | "image/webp",
        instruction: checkpoint.instruction,
        aiCriteria: checkpoint.aiCriteria ?? [],
      });
    } catch (err) {
      return NextResponse.json({ error: `AI judging failed: ${(err as Error).message}` }, { status: 502 });
    }

    // Best-effort - doc §7's dispute log still has the AI verdict and reason
    // even if the durable photo copy couldn't be stored.
    const photoUrl = await uploadPhoto(buffer, mediaType, `${teamId}-cp${checkpoint.checkpoint}`).catch(() => null);

    try {
      const result = engine.submitJudgement(teamId, judgement.verdict, {
        reason: judgement.reason,
        photoUrl: photoUrl ?? undefined,
        idempotencyKey,
        extra: { judgement },
      });
      return NextResponse.json({
        result,
        judgement,
        photoUrl,
        state: buildTeamStatePayload(engine, teamId),
      });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  });
}
