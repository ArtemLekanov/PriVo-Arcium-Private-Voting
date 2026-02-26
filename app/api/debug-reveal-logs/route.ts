import { NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { createHash } from "crypto";

function sha256First8Hex(name: string): string {
  const hash = createHash("sha256").update(name).digest();
  return hash.subarray(0, 8).toString("hex");
}

const EVENT_NAMES = [
  "event:RevealResultEvent",
  "event:reveal_result_event",
  "event:arcium_hello::RevealResultEvent",
  "event:arcium_hello::reveal_result_event",
  "RevealResultEvent",
];

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
    const programDataBlobs: { length: number; first8Hex: string; boolValue?: boolean }[] = [];

    for (const line of logMessages) {
      const idx = line.indexOf("Program data:");
      if (idx === -1) continue;
      const after = line.slice(idx + "Program data:".length).replace(/\s/g, "");
      if (!after) continue;
      try {
        const bin = Buffer.from(after, "base64");
        const first8 = bin.subarray(0, 8);
        const blob: { length: number; first8Hex: string; boolValue?: boolean } = {
          length: bin.length,
          first8Hex: Buffer.from(first8).toString("hex"),
        };
        if (bin.length >= 9) {
          const matchesEvent = EVENT_NAMES.some(
            (name) => sha256First8Hex(name) === blob.first8Hex
          );
          if (matchesEvent) {
            blob.boolValue = bin[8] !== 0;
          }
        }
        programDataBlobs.push(blob);
      } catch {
        programDataBlobs.push({ length: -1, first8Hex: "decode error" });
      }
    }

    const expectedDiscriminators: Record<string, string> = {};
    for (const name of EVENT_NAMES) {
      expectedDiscriminators[name] = sha256First8Hex(name);
    }

    const blobHexes = programDataBlobs.map((b) => b.first8Hex);
    const matchingNames: string[] = [];
    for (const name of EVENT_NAMES) {
      const hex = sha256First8Hex(name);
      if (blobHexes.includes(hex)) matchingNames.push(name);
    }

    const parsedResult = programDataBlobs.find((b) => b.boolValue !== undefined);

    return NextResponse.json({
      ok: true,
      logLineCount: logMessages.length,
      programDataBlobCount: programDataBlobs.length,
      programDataBlobs,
      expectedDiscriminators,
      matchingEventNames: matchingNames.length ? matchingNames : "No matching event discriminators found.",
      parsedBoolResult: parsedResult ? parsedResult.boolValue : null,
      fullLogs: logMessages,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
