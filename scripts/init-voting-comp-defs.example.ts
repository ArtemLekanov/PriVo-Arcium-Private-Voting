import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import {
  getArciumProgramId,
  getArciumProgram,
  getMXEAccAddress,
  getLookupTableAddress,
  getArciumAccountBaseSeed,
  getCompDefAccOffset,
} from "@arcium-hq/client";

const LUT_PROGRAM_ID = new PublicKey("AddressLookupTab1e1111111111111111111111111");

function readKpJson(path: string): anchor.web3.Keypair {
  const keypairPath = path.startsWith("~") ? path.replace("~", os.homedir()) : path;
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(keypairData));
}

function getCompDefPda(programId: PublicKey, compDefName: string): PublicKey {
  const arciumProgramId = getArciumProgramId();
  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const offsetBytes = getCompDefAccOffset(compDefName);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(baseSeed), programId.toBuffer(), offsetBytes],
    arciumProgramId
  );
  return pda;
}

async function main() {
  const useDevnet = process.env.USE_DEVNET === "1" || process.env.USE_DEVNET === "true";
  const programIdStr = process.env.DEPLOYED_PROGRAM_ID;
  if (!useDevnet || !programIdStr) {
    console.error("Set USE_DEVNET=1 and DEPLOYED_PROGRAM_ID");
    process.exit(1);
  }

  const programId = new PublicKey(programIdStr);
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
  const connection = new anchor.web3.Connection(rpcUrl, "confirmed");
  const keypairPath = process.env.ANCHOR_WALLET || `${os.homedir()}/.config/solana/id.json`;
  const wallet = new anchor.Wallet(readKpJson(keypairPath));
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const idlPath = "target/idl/arcium_hello.json";
  if (!fs.existsSync(idlPath)) {
    console.error("Run from arcium_hello root. Not found:", idlPath);
    process.exit(1);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const idlWithAddress = { ...idl, address: programIdStr };
  const program = new anchor.Program(idlWithAddress as anchor.Idl, provider);

  const mxeAccount = getMXEAccAddress(programId);
  const arciumProgramId = getArciumProgramId();

  let addressLookupTable: PublicKey;
  try {
    const arciumProgram = getArciumProgram(provider as anchor.AnchorProvider);
    const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const lutOffsetSlot = (mxeAcc as { lutOffsetSlot: anchor.BN }).lutOffsetSlot;
    addressLookupTable = getLookupTableAddress(programId, lutOffsetSlot);
  } catch (e) {
    console.error("Failed to get LUT (fetch MXE or decode):", e);
    process.exit(1);
  }

  const accountsBase = {
    payer: wallet.publicKey,
    mxeAccount,
    addressLookupTable,
    lutProgram: LUT_PROGRAM_ID,
    arciumProgram: arciumProgramId,
    systemProgram: SystemProgram.programId,
  };

  const inits = [
    { name: "init_vote_stats", method: "initVoteStatsCompDef" },
    { name: "vote", method: "initVoteCompDef" },
    { name: "reveal_result", method: "initRevealResultCompDef" },
  ] as const;

  for (const { name, method } of inits) {
    const compDefAccount = getCompDefPda(programId, name);
    const methods = program.methods as Record<string, () => { accounts: (a: object) => { rpc: () => Promise<string> } }>;
    const m = methods[method];
    if (!m) {
      console.warn(`Skip ${method}: not in IDL. Update IDL from VPS build.`);
      continue;
    }
    try {
      await m()
        .accounts({ ...accountsBase, compDefAccount })
        .rpc();
      console.log(`${method} ok`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const logs = (err as { transactionLogs?: string[] }).transactionLogs?.join(" ") ?? "";
      if (
        msg.includes("already in use") ||
        msg.includes("custom program error: 0x0") ||
        logs.includes("already in use")
      ) {
        console.log(`${method}: already initialized, skipping`);
        continue;
      }
      console.error(`${method} failed:`, err);
      process.exit(1);
    }
  }

  console.log("All voting comp defs initialized.");
  console.log("Next step: run upload-voting-circuits.ts — it will upload circuit bytes AND finalize (do not finalize here, as in the official example).");
}

main();
