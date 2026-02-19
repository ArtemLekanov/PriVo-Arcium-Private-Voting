import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("CFbzcvAxXg8kX52gWeDKjWqSMV5v8aMg9csB75KgQYvK");

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
    const data = accountInfo.data;
    const MIN_SIZE_WITH_REVEALED = 235;
    if (data.length < MIN_SIZE_WITH_REVEALED) {
      return NextResponse.json({
        error: "old_poll_account",
        authority: authorityStr,
        pollId,
        dataLength: data.length,
        hint: "This poll was created before the program update (no revealed_yes/no/maybe fields). Create a new poll after deploying the updated program, vote, and click Reveal results.",
      });
    }
    if (data.length < 24) {
      return NextResponse.json({ error: "not revealed", authority: authorityStr, pollId });
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const yes = Number(view.getBigUint64(data.length - 24, true));
    const no = Number(view.getBigUint64(data.length - 16, true));
    const maybe = Number(view.getBigUint64(data.length - 8, true));
    const total = yes + no + maybe;
    const hint =
      total === 0
        ? "All zeros: click Reveal results (creator wallet) after voting. If you already did, check the reveal transaction in Solscan."
        : undefined;
    const out: Record<string, unknown> = hint ? { yes, no, maybe, hint } : { yes, no, maybe };
    if (searchParams.get("debug") === "1") {
      const last32 = data.slice(Math.max(0, data.length - 32));
      out.debug = {
        dataLength: data.length,
        last32BytesHex: Buffer.from(last32).toString("hex"),
        readAsU64: { yes, no, maybe },
      };
    }
    return NextResponse.json(out);
  } catch (e) {
    console.error("poll-results API error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch" },
      { status: 500 }
    );
  }
}
