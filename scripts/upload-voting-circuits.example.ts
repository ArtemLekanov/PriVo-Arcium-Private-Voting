/**
 * Upload voting circuits (uploadCircuit) to Devnet.
 * Run on VPS in arcium_hello project AFTER init_*_comp_def and BEFORE create_new_poll.
 * Without this step create_new_poll returns error 6300.
 *
 * Note: public RPC (api.devnet.solana.com) returns 429 Too Many Requests under load.
 * Use a paid RPC (Helius, QuickNode, etc.) via ANCHOR_PROVIDER_URL.
 *
 * Run:
 *   USE_DEVNET=1 \
 *   DEPLOYED_PROGRAM_ID=CFbzcvAxXg8kX52gWeDKjWqSMV5v8aMg9csB75KgQYvK \
 *   ANCHOR_WALLET=/root/.config/solana/id.json \
 *   ANCHOR_PROVIDER_URL="https://devnet.helius-rpc.com/?api-key=YOUR_KEY" \
 *   npx ts-node scripts/upload-voting-circuits.ts
 *
 * Optional: UPLOAD_CHUNK_SIZE=10 — fewer concurrent requests (default 10; client uses 500).
 *
 * Without paid RPC (429): delay between circuits. With public Devnet:
 *   USE_DEVNET=1 DEPLOYED_PROGRAM_ID=... ANCHOR_WALLET=... \
 *   CIRCUIT_DELAY_MS=90000 \
 *   npx ts-node scripts/upload-voting-circuits.ts
 * (CIRCUIT_DELAY_MS=90000 — 90s between circuits if RPC not set.)
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { uploadCircuit } from "@arcium-hq/client";

function readKpJson(keypairPath: string): anchor.web3.Keypair {
  const resolved = keypairPath.startsWith("~") ? keypairPath.replace("~", os.homedir()) : keypairPath;
  const data = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(data));
}

async function main() {
  const programIdStr = process.env.DEPLOYED_PROGRAM_ID;
  const useDevnet = process.env.USE_DEVNET === "1" || process.env.USE_DEVNET === "true";
  if (!useDevnet || !programIdStr) {
    console.error("Set USE_DEVNET=1 and DEPLOYED_PROGRAM_ID");
    process.exit(1);
  }

  const programId = new PublicKey(programIdStr);
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
  if (!process.env.ANCHOR_PROVIDER_URL) {
    console.warn("Warning: using public RPC. For upload use ANCHOR_PROVIDER_URL (e.g. Helius) to avoid 429.");
  }
  const connection = new anchor.web3.Connection(rpcUrl, "confirmed");
  const keypairPath = process.env.ANCHOR_WALLET || `${os.homedir()}/.config/solana/id.json`;
  const wallet = new anchor.Wallet(readKpJson(keypairPath));
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const circuitsDir = process.env.CIRCUITS_DIR || path.join(process.cwd(), "build");
  const names = ["init_vote_stats", "vote", "reveal_result"] as const;
  const usePublicRpc = !process.env.ANCHOR_PROVIDER_URL;
  const delayMs = usePublicRpc
    ? Math.max(60000, parseInt(process.env.CIRCUIT_DELAY_MS ?? "90000", 10))
    : parseInt(process.env.CIRCUIT_DELAY_MS ?? "0", 10);
  if (delayMs > 0) {
    console.log(`Delay between circuits: ${delayMs / 1000}s (to avoid 429 on public RPC).`);
  }

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (i > 0 && delayMs > 0) {
      console.log(`Waiting ${delayMs / 1000}s before ${name}...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
    const possiblePaths = [
      path.join(circuitsDir, `${name}.arcis`),
      path.join(process.cwd(), "build", `${name}.arcis`),
      path.join(process.cwd(), "target", "deploy", `${name}.arcis`),
      path.join(process.cwd(), "encrypted-ixs", "target", "deploy", `${name}.arcis`),
    ];
    let rawCircuit: Buffer | null = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        rawCircuit = fs.readFileSync(p);
        console.log(`Using circuit file: ${p}`);
        break;
      }
    }
    if (!rawCircuit) {
      console.warn(`Skip ${name}: no .arcis found in ${circuitsDir} or build/. Set CIRCUITS_DIR if needed.`);
      continue;
    }
    try {
      const defaultChunk = usePublicRpc ? 3 : 10;
      const chunkSize = Math.max(1, parseInt(process.env.UPLOAD_CHUNK_SIZE ?? String(defaultChunk), 10));
      const sigs = await uploadCircuit(
        provider as anchor.AnchorProvider,
        name,
        programId,
        new Uint8Array(rawCircuit),
        true,
        chunkSize
      );
      console.log(`${name} uploaded and finalized:`, sigs);
    } catch (err) {
      console.error(`${name} upload failed:`, err);
      if (usePublicRpc && (String(err).includes("429") || String(err).includes("Too Many Requests"))) {
        console.error("Tip: wait a few minutes and run the script again — it will skip already-uploaded circuits if you add that logic, or use CIRCUIT_DELAY_MS=120000 (2 min).");
      }
      process.exit(1);
    }
  }

  console.log("All voting circuits uploaded.");
}

main();
