import { NextRequest, NextResponse } from "next/server";
import { arciumClient } from "../../arcium-client";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { publicKey, vote } = body;

    if (!publicKey || !vote) {
      return NextResponse.json(
        { error: "Missing publicKey or vote" },
        { status: 400 }
      );
    }

    const hasMxeId = Boolean(process.env.ARCIUM_MXE_PROGRAM_ID);
    console.log("[encrypt-vote] ARCIUM_MXE_PROGRAM_ID set:", hasMxeId);

    const encryptedVote = await arciumClient.encrypt({
      publicKey,
      data: { vote },
    });

    console.log("[encrypt-vote] mode:", encryptedVote.mode);
    return NextResponse.json({ encryptedVote });
  } catch (error) {
    console.error("Error encrypting vote:", error);
    return NextResponse.json(
      { error: "Failed to encrypt vote", details: String(error) },
      { status: 500 }
    );
  }
}
