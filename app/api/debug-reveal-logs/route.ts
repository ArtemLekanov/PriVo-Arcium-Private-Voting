import { NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { createHash } from "crypto";

function sha256First8Hex(name: string): string {
  const hash = createHash("sha256").update(name).digest();
  return hash.subarray(0, 8).toString("hex");
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const signature = searchParams.get("signature");
  if (!signature) {
    return NextResponse.json({ error: "?signature= required" }, { status: 400 });
  }

  try {
    const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
    const connection = new Connection(rpcUrl, "confirmed");
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      return NextResponse.json({ ok: false, error: "Transaction not found" });
    }

    const logMessages = tx.meta?.logMessages ?? [];
    const programDataBlobs: { length: number; first8Hex: string }[] = [];

    for (const line of logMessages) {
      const idx = line.indexOf("Program data:");
      if (idx === -1) continue;
      const after = line.slice(idx + "Program data:".length).replace(/\s/g, "");
      if (!after) continue;
      try {
        const bin = Buffer.from(after, "base64");
        const first8 = bin.subarray(0, 8);
        const blob: { length: number; first8Hex: string; u64_at_8_16_24?: number[]; u64_at_16_24_32?: number[] } = {
          length: bin.length,
          first8Hex: Buffer.from(first8).toString("hex"),
        };
        if (bin.length >= 32) {
          blob.u64_at_8_16_24 = [
            bin.readBigUInt64LE(8),
            bin.readBigUInt64LE(16),
            bin.readBigUInt64LE(24),
          ].map((n) => Number(n));
        }
        if (bin.length >= 40) {
          blob.u64_at_16_24_32 = [
            bin.readBigUInt64LE(16),
            bin.readBigUInt64LE(24),
            bin.readBigUInt64LE(32),
          ].map((n) => Number(n));
        }
        programDataBlobs.push(blob);
      } catch {
        programDataBlobs.push({ length: -1, first8Hex: "decode error" });
      }
    }

    const expectedDiscriminators: Record<string, string> = {
      "event:RevealResultEvent": sha256First8Hex("event:RevealResultEvent"),
      "event:reveal_result_event": sha256First8Hex("event:reveal_result_event"),
      "event:arcium_hello::RevealResultEvent": sha256First8Hex("event:arcium_hello::RevealResultEvent"),
      "event:arcium_hello::reveal_result_event": sha256First8Hex("event:arcium_hello::reveal_result_event"),
      "RevealResultEvent": sha256First8Hex("RevealResultEvent"),
    };

    const blobHexes = programDataBlobs.map((b) => b.first8Hex);
    const tryNames = [
      "event:RevealResultEvent",
      "event:reveal_result_event",
      "event:arcium_hello::RevealResultEvent",
      "event:arcium_hello::reveal_result_event",
      "RevealResultEvent",
      "event:RevealResult",
      "event:reveal_result",
      "RevealResult",
      "event:RevealVotingResult",
      "event:reveal_voting_result",
    ];
    const matchingNames: string[] = [];
    for (const name of tryNames) {
      const hex = sha256First8Hex(name);
      if (blobHexes.includes(hex)) matchingNames.push(name);
    }

    const allHuge = programDataBlobs.every(
      (b) =>
        (b as { u64_at_8_16_24?: number[] }).u64_at_8_16_24?.every((n) => n > 1e15) ?? false
    );
    const conclusion =
      allHuge && programDataBlobs.length > 0
        ? "Both blocks contain only large numbers (10^18+) - this is Arcium data, not RevealResultEvent. The emit!(RevealResultEvent) from callback may not appear in this transaction's logs (Arcium architecture). Options: check with Arcium how to get callback result; or write yes/no/maybe to the account in callback and read from chain."
        : undefined;

    return NextResponse.json({
      ok: true,
      logLineCount: logMessages.length,
      programDataBlobCount: programDataBlobs.length,
      programDataBlobs,
      expectedDiscriminators,
      matchingEventNames: matchingNames.length ? matchingNames : "None of the checked variants matched the blocks' first8Hex. Check the event name in Rust (struct with #[event]).",
      conclusion,
      fullLogs: logMessages,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
