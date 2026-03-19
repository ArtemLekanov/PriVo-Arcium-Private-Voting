import { NextResponse } from "next/server";
import { PublicKey, Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import { createHash } from "crypto";
import { PROGRAM_ID } from "@/app/lib/program-id";

const SET_WHITELIST_DISCRIMINATOR = createHash("sha256")
  .update("global:set_whitelist")
  .digest()
  .subarray(0, 8);

function u32LE(value: number): Uint8Array {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, value, true);
  return new Uint8Array(buf);
}

function getPollPDA(authority: PublicKey, pollId: number): [PublicKey, number] {
  const idBytes = new Uint8Array(4);
  new DataView(idBytes.buffer).setUint32(0, pollId, true);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("poll"), authority.toBytes(), idBytes],
    PROGRAM_ID
  );
}

function getWhitelistPDA(pollAcc: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), pollAcc.toBuffer()],
    PROGRAM_ID
  );
}

function serializeSetWhitelistData(pollId: number, addresses: PublicKey[]): Uint8Array {
  const parts: Uint8Array[] = [
    new Uint8Array(SET_WHITELIST_DISCRIMINATOR),
    u32LE(pollId),
    u32LE(addresses.length),
  ];
  for (const addr of addresses) {
    parts.push(addr.toBytes());
  }
  const total = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      publicKey: authorityStr,
      pollId,
      addresses: addressStrings,
    } = body as {
      publicKey?: string;
      pollId?: number;
      addresses?: string[];
    };

    if (!authorityStr || pollId === undefined || !Array.isArray(addressStrings)) {
      return NextResponse.json(
        { error: "publicKey, pollId, addresses[] required" },
        { status: 400 }
      );
    }

    if (addressStrings.length > 100) {
      return NextResponse.json(
        { error: "Maximum 100 addresses per whitelist" },
        { status: 400 }
      );
    }

    const authority = new PublicKey(authorityStr);
    const addresses: PublicKey[] = [];
    for (const s of addressStrings) {
      try {
        addresses.push(new PublicKey(s.trim()));
      } catch {
        return NextResponse.json(
          { error: `Invalid address: ${s}` },
          { status: 400 }
        );
      }
    }

    const [pollAcc] = getPollPDA(authority, Number(pollId));
    const [whitelistPda] = getWhitelistPDA(pollAcc);

    const data = serializeSetWhitelistData(Number(pollId), addresses);

    const instruction = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: authority, isSigner: true, isWritable: true },
        { pubkey: pollAcc, isSigner: false, isWritable: false },
        { pubkey: whitelistPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(data),
    });

    const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
    const { Connection } = await import("@solana/web3.js");
    const connection = new Connection(rpcUrl, "confirmed");
    const { blockhash } = await connection.getLatestBlockhash();

    const transaction = new Transaction().add(instruction);
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = authority;

    const serialized = transaction.serialize({ requireAllSignatures: false });
    const base64 = Buffer.from(serialized).toString("base64");

    return NextResponse.json({ transaction: base64 });
  } catch (e) {
    console.error("set-whitelist API error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to build transaction" },
      { status: 500 }
    );
  }
}
