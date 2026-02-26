/**
 * GET /api/poll-results?authority=...&pollId=0
 *
 * Deprecated: the reveal_result_callback no longer writes results to the poll account.
 * Results are now emitted as RevealResultEvent { output: bool } in the callback transaction logs.
 * This endpoint is kept for backward compatibility but will always return { revealed: false }.
 */

import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import { PROGRAM_ID } from "@/app/lib/program-id";

function getPollPDA(authority: PublicKey, pollId: number): [PublicKey, number] {
  const idBytes = new Uint8Array(4);
  new DataView(idBytes.buffer).setUint32(0, pollId, true);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("poll"), authority.toBytes(), idBytes],
    PROGRAM_ID
  );
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const authorityStr = searchParams.get("authority");
    const pollId = parseInt(searchParams.get("pollId") ?? "0", 10);
    if (!authorityStr) {
      return NextResponse.json({ error: "authority required" }, { status: 400 });
    }
    const authority = new PublicKey(authorityStr);
    const [pollPda] = getPollPDA(authority, pollId);

    const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
    const { Connection } = await import("@solana/web3.js");
    const connection = new Connection(rpcUrl, "confirmed");
    const accountInfo = await connection.getAccountInfo(pollPda);
    if (!accountInfo?.data) {
      return NextResponse.json({ error: "no account", authority: authorityStr, pollId });
    }

    return NextResponse.json({
      revealed: false,
      hint: "Results are no longer stored on-chain. Use the callback transaction logs to read RevealResultEvent { output: bool }.",
      accountExists: true,
      dataLength: accountInfo.data.length,
    });
  } catch (e) {
    console.error("poll-results API error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch" },
      { status: 500 }
    );
  }
}
