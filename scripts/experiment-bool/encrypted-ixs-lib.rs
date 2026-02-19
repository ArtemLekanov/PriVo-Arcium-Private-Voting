// ============================================================
// EXPERIMENT: bool + 2 fields (like official voting example)
// Copy this file to VPS as: encrypted-ixs/src/lib.rs
// (backup current lib.rs before replacing)
// ============================================================

use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    pub struct InputValues {
        v1: u8,
        v2: u8,
    }

    #[instruction]
    pub fn add_together(input_ctxt: Enc<Shared, InputValues>) -> Enc<Shared, u16> {
        let input = input_ctxt.to_arcis();
        let sum = input.v1 as u16 + input.v2 as u16;
        input_ctxt.owner.from_arcis(sum)
    }

    // Voting: bool (yes/no) + 2 counters, as in official example
    pub struct VoteStats {
        yes: u64,
        no: u64,
    }

    pub struct UserVote {
        vote: bool,
    }

    #[instruction]
    pub fn init_vote_stats(mxe: Mxe) -> Enc<Mxe, VoteStats> {
        let vote_stats = VoteStats { yes: 0, no: 0 };
        mxe.from_arcis(vote_stats)
    }

    #[instruction]
    pub fn vote(
        vote_ctxt: Enc<Shared, UserVote>,
        vote_stats_ctxt: Enc<Mxe, VoteStats>,
    ) -> Enc<Mxe, VoteStats> {
        let user_vote = vote_ctxt.to_arcis();
        let mut vote_stats = vote_stats_ctxt.to_arcis();
        if user_vote.vote {
            vote_stats.yes += 1;
        } else {
            vote_stats.no += 1;
        }
        vote_stats_ctxt.owner.from_arcis(vote_stats)
    }

    /// Reveal only yes and no (experiment: 2 fields).
    #[instruction]
    pub fn reveal_result(vote_stats_ctxt: Enc<Mxe, VoteStats>) -> (u64, u64) {
        let vote_stats = vote_stats_ctxt.to_arcis();
        (vote_stats.yes.reveal(), vote_stats.no.reveal())
    }
}
