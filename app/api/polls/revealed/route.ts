import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { authority, pollId, yesWins, revealSignature } = body as {
      authority?: string;
      pollId?: number;
      yesWins?: boolean;
      revealSignature?: string;
    };
    if (
      !authority ||
      pollId === undefined ||
      pollId === null ||
      typeof yesWins !== "boolean"
    ) {
      return NextResponse.json(
        { error: "authority, pollId, yesWins (boolean) required" },
        { status: 400 }
      );
    }
    const now = BigInt(Date.now());
    await prisma.poll.upsert({
      where: {
        authority_pollId: { authority: String(authority), pollId: Number(pollId) },
      },
      create: {
        authority: String(authority),
        pollId: Number(pollId),
        question: `Poll ${pollId}`,
        createdAt: now,
        revealedAt: now,
        yesWins,
        revealSignature:
          typeof revealSignature === "string" && revealSignature.length > 0
            ? revealSignature
            : null,
      },
      update: {
        revealedAt: now,
        yesWins,
        revealSignature:
          typeof revealSignature === "string" && revealSignature.length > 0
            ? revealSignature
            : null,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("polls/revealed POST error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save revealed result" },
      { status: 500 }
    );
  }
}
