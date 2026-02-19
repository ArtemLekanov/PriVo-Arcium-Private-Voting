/**
 * Paste this block into tests/arcium_hello.ts on VPS.
 *
 * 1. Paste the second test it("Voting: ...") right after the first it("Is initialized!", ...) closes
 *    (after the line with expect(decrypted).to.equal(val1 + val2); and });
 *
 * 2. Paste the three functions initVoteStatsCompDef, initVoteCompDef, initRevealResultCompDef
 *    before the closing }); of the describe("ArciumHello", ...) block.
 *
 * 3. In arcium_hello root on VPS you need built circuits:
 *    build/init_vote_stats.arcis, build/vote.arcis, build/reveal_result.arcis
 *    (run: arcium build)
 *
 * 4. If IDL has no "voteEvent", the test will fail at awaitEvent("voteEvent").
 *    Then use only finalization wait + reveal check (see PRIVATE-VOTING-STEPS.md).
 */

// ============ Paste start: second test ============

  it("Voting: create poll, vote, finalize, reveal", async () => {
    const POLL_ID = 0;
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId,
    );
    console.log("MXE x25519 pubkey ok (voting)");

    console.log("Initializing vote stats computation definition");
    const initVoteStatsSig = await initVoteStatsCompDef(program, owner);
    console.log("init_vote_stats_comp_def:", initVoteStatsSig);

    console.log("Initializing vote computation definition");
    const initVoteSig = await initVoteCompDef(program, owner);
    console.log("init_vote_comp_def:", initVoteSig);

    console.log("Initializing reveal_result computation definition");
    const initRRSig = await initRevealResultCompDef(program, owner);
    console.log("init_reveal_result_comp_def:", initRRSig);

    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    const pollNonce = randomBytes(16);
    const pollComputationOffset = new anchor.BN(randomBytes(8), "hex");

    const pollSig = await program.methods
      .createNewPoll(
        pollComputationOffset,
        POLL_ID,
        "Local test poll",
        new anchor.BN(deserializeLE(pollNonce).toString()),
      )
      .accountsPartial({
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          pollComputationOffset,
        ),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(
          arciumEnv.arciumClusterOffset,
        ),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("init_vote_stats")).readUInt32LE(),
        ),
      })
      .rpc({
        skipPreflight: true,
        preflightCommitment: "confirmed",
        commitment: "confirmed",
      });
    console.log("create_new_poll:", pollSig);

    const finalizePollSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      pollComputationOffset,
      program.programId,
      "confirmed",
    );
    console.log("finalize poll:", finalizePollSig);

    const voteValue = 1;
    const plaintext = [BigInt(voteValue)];
    const nonce = randomBytes(16);
    const ciphertext = cipher.encrypt(plaintext, nonce);

    const voteComputationOffset = new anchor.BN(randomBytes(8), "hex");
    const voteEventPromise = awaitEvent("voteEvent" as keyof Event);

    const queueVoteSig = await program.methods
      .vote(
          voteComputationOffset,
          POLL_ID,
          Array.from(ciphertext[0] ?? new Array(32).fill(0)),
          Array.from(publicKey),
          new anchor.BN(deserializeLE(nonce).toString()),
        )
        .accountsPartial({
          computationAccount: getComputationAccAddress(
            arciumEnv.arciumClusterOffset,
            voteComputationOffset,
          ),
          clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
          executingPool: getExecutingPoolAccAddress(
            arciumEnv.arciumClusterOffset,
          ),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("vote")).readUInt32LE(),
          ),
          authority: owner.publicKey,
        })
        .rpc({
          skipPreflight: true,
          preflightCommitment: "confirmed",
          commitment: "confirmed",
        });
    console.log("vote queue:", queueVoteSig);

    const finalizeVoteSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      voteComputationOffset,
      program.programId,
      "confirmed",
    );
    console.log("finalize vote:", finalizeVoteSig);

    const voteEvent = await voteEventPromise;
    console.log("VoteEvent received:", (voteEvent as { timestamp?: anchor.BN })?.timestamp?.toString());
    expect(voteEvent).to.not.be.undefined;

    const revealComputationOffset = new anchor.BN(randomBytes(8), "hex");
    const revealEventPromise = awaitEvent("revealResultEvent" as keyof Event);

    const revealQueueSig = await program.methods
      .revealResult(revealComputationOffset, POLL_ID)
      .accountsPartial({
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          revealComputationOffset,
        ),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(
          arciumEnv.arciumClusterOffset,
        ),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("reveal_result")).readUInt32LE(),
        ),
      })
      .rpc({
        skipPreflight: true,
        preflightCommitment: "confirmed",
        commitment: "confirmed",
      });
    console.log("reveal queue:", revealQueueSig);

    const revealFinalizeSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      revealComputationOffset,
      program.programId,
      "confirmed",
    );
    console.log("reveal finalize:", revealFinalizeSig);

    const revealEvent = await revealEventPromise;
    console.log("RevealResultEvent:", revealEvent);
    expect(revealEvent).to.not.be.undefined;
  });

  async function initVoteStatsCompDef(
    program: Program<ArciumHello>,
    owner: anchor.web3.Keypair,
  ): Promise<string> {
    const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
    const offset = getCompDefAccOffset("init_vote_stats");
    const compDefPDA = PublicKey.findProgramAddressSync(
      [Buffer.from(baseSeed), program.programId.toBuffer(), offset],
      getArciumProgramId(),
    )[0];

    const mxeAccount = getMXEAccAddress(program.programId);
    const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const lutAddress = getLookupTableAddress(program.programId, mxeAcc.lutOffsetSlot);

    const sig = await program.methods
      .initVoteStatsCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount,
        addressLookupTable: lutAddress,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    const rawCircuit = fs.readFileSync("build/init_vote_stats.arcis");
    await uploadCircuit(
      provider as anchor.AnchorProvider,
      "init_vote_stats",
      program.programId,
      rawCircuit,
      true,
    );
    return sig;
  }

  async function initVoteCompDef(
    program: Program<ArciumHello>,
    owner: anchor.web3.Keypair,
  ): Promise<string> {
    const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
    const offset = getCompDefAccOffset("vote");
    const compDefPDA = PublicKey.findProgramAddressSync(
      [Buffer.from(baseSeed), program.programId.toBuffer(), offset],
      getArciumProgramId(),
    )[0];

    const mxeAccount = getMXEAccAddress(program.programId);
    const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const lutAddress = getLookupTableAddress(program.programId, mxeAcc.lutOffsetSlot);

    const sig = await program.methods
      .initVoteCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount,
        addressLookupTable: lutAddress,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    const rawCircuit = fs.readFileSync("build/vote.arcis");
    await uploadCircuit(
      provider as anchor.AnchorProvider,
      "vote",
      program.programId,
      rawCircuit,
      true,
    );
    return sig;
  }

  async function initRevealResultCompDef(
    program: Program<ArciumHello>,
    owner: anchor.web3.Keypair,
  ): Promise<string> {
    const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
    const offset = getCompDefAccOffset("reveal_result");
    const compDefPDA = PublicKey.findProgramAddressSync(
      [Buffer.from(baseSeed), program.programId.toBuffer(), offset],
      getArciumProgramId(),
    )[0];

    const mxeAccount = getMXEAccAddress(program.programId);
    const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const lutAddress = getLookupTableAddress(program.programId, mxeAcc.lutOffsetSlot);

    const sig = await program.methods
      .initRevealResultCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount,
        addressLookupTable: lutAddress,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    const rawCircuit = fs.readFileSync("build/reveal_result.arcis");
    await uploadCircuit(
      provider as anchor.AnchorProvider,
      "reveal_result",
      program.programId,
      rawCircuit,
      true,
    );
    return sig;
  }

// ============ Paste end ============
