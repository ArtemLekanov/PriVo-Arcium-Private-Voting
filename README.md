# PriVo — Private Voting on Solana (Arcium Integration)

A functional Solana dApp for private on-chain voting: create polls, cast encrypted votes, and reveal aggregate results. Integrated with **Arcium** for confidential vote processing.

---

## How Arcium Is Used

- **Encryption (client → chain)**  
  Votes are encrypted before leaving the user’s flow. The app uses Arcium’s cipher (RescueCipher + x25519) so that only ciphertext is sent on-chain. With `ARCIUM_MXE_PROGRAM_ID` set, the encryption key is the real MXE public key from your Arcium deployment on Devnet; otherwise a demo key is used for local testing.

- **Private tally (on-chain)**  
  The Solana program submits encrypted votes into Arcium’s MXE (Multi-Execution Environment). Counting happens **inside** the confidential environment; no one (including RPC nodes or the app backend) sees individual votes. Only the poll creator can trigger **Reveal results**, which runs an Arcium computation that outputs the final counts (Yes / No / Maybe) and writes them on-chain with integrity guarantees.

- **Where it appears in the repo**  
  - Server-side encryption: `app/arcium-client.ts`, `app/api/encrypt-vote/route.ts`  
  - Building vote/reveal transactions that talk to the program + Arcium: `app/api/vote/route.ts`, `app/api/reveal-result/route.ts`  
  - Program IDs and PDAs are aligned with an Arcium-backed Solana program (e.g. init_vote_stats, vote, reveal_result computation definitions).

---

## Privacy Benefits

- **Vote secrecy**  
  Individual votes are never stored or transmitted in the clear. Only ciphertext is on-chain; decryption and aggregation happen inside Arcium’s trusted execution environment.

- **No early leakage**  
  Intermediate counts are not visible. Results become public only when the poll creator runs **Reveal results**, which publishes only the final aggregates (and proofs), not who voted what.

- **Integrity**  
  The same environment that keeps votes private also attests to the correctness of the tally, so the published counts can be trusted.

---

## Run

```bash
npm install
npx prisma generate
npm run dev
```

Optional `.env`: `NEXT_PUBLIC_SOLANA_RPC_URL`, `ARCIUM_MXE_PROGRAM_ID` (for real MXE key on Devnet).

---

## Stack

- **Frontend:** Next.js, React, Tailwind CSS  
- **Chain:** Solana (wallet-adapter, web3.js), Devnet  
- **Confidential layer:** Arcium (RescueCipher, x25519, MXE)  
- **Storage:** Prisma, SQLite (polls metadata / UX); on-chain for votes and results

---

## Repository

Open source on GitHub. All project materials are in English.
