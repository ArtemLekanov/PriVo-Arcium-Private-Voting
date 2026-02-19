/**
 * Polls catalog: DB-backed. Voting = all polls, Results = by authority.
 * GET — all polls or ?authority= for creator's polls.
 * POST — register poll (after successful create_new_poll tx).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export type PollEntry = {
  authority: string;
  pollId: number;
  question: string;
  description?: string;
  createdAt?: number;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const authority = searchParams.get("authority");

    const list = authority
      ? await prisma.poll.findMany({
          where: { authority },
          orderBy: { pollId: "asc" },
        })
      : await prisma.poll.findMany({ orderBy: [{ authority: "asc" }, { pollId: "asc" }] });

    const polls: PollEntry[] = list.map((p) => ({
      authority: p.authority,
      pollId: p.pollId,
      question: p.question,
      description: p.description ?? undefined,
      createdAt: p.createdAt != null ? Number(p.createdAt) : undefined,
    }));

    return NextResponse.json({ polls });
  } catch (e) {
    console.error("polls GET error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch polls" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { authority, pollId, question, description } = body as {
      authority?: string;
      pollId?: number;
      question?: string;
      description?: string;
    };
    if (!authority || pollId === undefined || pollId === null || !question || typeof question !== "string") {
      return NextResponse.json(
        { error: "authority, pollId, question required" },
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
        question: question.slice(0, 200),
        description: typeof description === "string" ? description.slice(0, 500) : null,
        createdAt: now,
      },
      update: {
        question: question.slice(0, 200),
        description: typeof description === "string" ? description.slice(0, 500) : null,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("polls register error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to register poll" },
      { status: 500 }
    );
  }
}
