import { PublicKey } from "@solana/web3.js";

const DEFAULT_PROGRAM_ID = "CFbzcvAxXg8kX52gWeDKjWqSMV5v8aMg9csB75KgQYvK";

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_VOTING_PROGRAM_ID || DEFAULT_PROGRAM_ID
);
