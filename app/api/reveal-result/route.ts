import { NextResponse } from "next/server";
import { PublicKey, Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import {
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getArciumAccountBaseSeed,
  getCompDefAccOffset,
} from "@arcium-hq/client";
import { createHash } from "crypto";

const PROGRAM_ID = new PublicKey("CFbzcvAxXg8kX52gWeDKjWqSMV5v8aMg9csB75KgQYvK");
const CLUSTER_OFFSET = 456;
const POOL_ACCOUNT = new PublicKey("G2sRWJvi3xoyh5k2gY49eG9L8YhAEWQPtNb1zb1GXTtC");
const CLOCK_ACCOUNT = new PublicKey("7EbMUTLo5DjdzbN7s8BXeZwXzEwNQb1hScfRvWg8a6ot");
const ARCIUM_PROGRAM_ID = new PublicKey("Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ");

function getRevealResultDiscriminator(): Uint8Array {
  const hash = createHash("sha256").update("global:reveal_result").digest();
  return new Uint8Array(hash.subarray(0, 8));
}

function u64LE(value: bigint): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, value, true);
  return new Uint8Array(buf);
}
function u32LE(value: number): Uint8Array {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, value, true);
  return new Uint8Array(buf);
}

function getSignPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ArciumSignerAccount")],
    PROGRAM_ID
  );
}

function getPollPDA(authority: PublicKey, pollId: number): [PublicKey, number] {
  const idBytes = new Uint8Array(4);
  new DataView(idBytes.buffer).setUint32(0, pollId, true);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("poll"), authority.toBytes(), idBytes],
    PROGRAM_ID
  );
}

function getRevealResultCompDefPDA(): PublicKey {
  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const offsetBytes = getCompDefAccOffset("reveal_result");
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(baseSeed), PROGRAM_ID.toBuffer(), offsetBytes],
    ARCIUM_PROGRAM_ID
  );
  return pda;
}

function serializeRevealResultData(computationOffset: bigint, pollId: number): Uint8Array {
  const parts = [
    getRevealResultDiscriminator(),
    u64LE(computationOffset),
    u32LE(pollId),
  ];
  const total = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function randomU64(): bigint {
  const buf = new Uint8Array(8);
  const nodeCrypto = require("crypto") as { randomFillSync: (b: Uint8Array) => void };
  nodeCrypto.randomFillSync(buf);
  return new DataView(buf.buffer).getBigUint64(0, true);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { publicKey: authorityStr, pollId = 0 } = body;

    if (!authorityStr) {
      return NextResponse.json({ error: "publicKey (authority) required" }, { status: 400 });
    }

    const authority = new PublicKey(authorityStr);
    const [signPda] = getSignPDA();
    const [pollAcc] = getPollPDA(authority, Number(pollId));
    const computationOffset = randomU64();

    const mxeAccount = getMXEAccAddress(PROGRAM_ID);
    const mempoolAccount = getMempoolAccAddress(CLUSTER_OFFSET);
    const executingPool = getExecutingPoolAccAddress(CLUSTER_OFFSET);
    const compDefAccount = getRevealResultCompDefPDA();
    const clusterAccount = getClusterAccAddress(CLUSTER_OFFSET);
    const computationOffsetBnLike = {
      toArrayLike: (_: unknown, __: string, len: number) =>
        Buffer.from(u64LE(computationOffset).buffer, 0, len),
    };
    const computationAccount = getComputationAccAddress(
      CLUSTER_OFFSET,
      computationOffsetBnLike as { toArrayLike: (b: unknown, le: string, l: number) => Buffer }
    );

    const data = serializeRevealResultData(computationOffset, Number(pollId));

    const instruction = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: authority, isSigner: true, isWritable: true },
        { pubkey: signPda, isSigner: false, isWritable: true },
        { pubkey: mxeAccount, isSigner: false, isWritable: false },
        { pubkey: mempoolAccount, isSigner: false, isWritable: true },
        { pubkey: executingPool, isSigner: false, isWritable: true },
        { pubkey: computationAccount, isSigner: false, isWritable: true },
        { pubkey: compDefAccount, isSigner: false, isWritable: false },
        { pubkey: clusterAccount, isSigner: false, isWritable: true },
        { pubkey: POOL_ACCOUNT, isSigner: false, isWritable: true },
        { pubkey: CLOCK_ACCOUNT, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: pollAcc, isSigner: false, isWritable: false },
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
    console.error("reveal-result API error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to build transaction" },
      { status: 500 }
    );
  }
}
