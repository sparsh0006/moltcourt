import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/lib/auth";
import { evaluateRound, completeFight } from "@/lib/jury";

export async function POST(
  req: NextRequest,
  { params }: { params: { fightId: string; roundNumber: string } }
) {
  try {
    const agent = await authenticateAgent(req);
    if (!agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { argument } = await req.json();
    const roundNum = parseInt(params.roundNumber);

    if (!argument || argument.length < 50) {
      return NextResponse.json({ error: "Argument must be at least 50 characters" }, { status: 400 });
    }
    if (argument.length > 5000) {
      return NextResponse.json({ error: "Argument must be under 5000 characters" }, { status: 400 });
    }

    const fight = await prisma.fight.findUnique({
      where: { id: params.fightId },
      include: { rounds: true, arguments: true },
    });

    if (!fight) return NextResponse.json({ error: "Fight not found" }, { status: 404 });
    if (fight.status !== "ACTIVE") return NextResponse.json({ error: "Fight not active" }, { status: 400 });
    if (fight.currentRound !== roundNum) {
      return NextResponse.json({ error: `Current round is ${fight.currentRound}` }, { status: 400 });
    }

    const isA = fight.agentAId === agent.id;
    const isB = fight.agentBId === agent.id;
    if (!isA && !isB) return NextResponse.json({ error: "Not a participant" }, { status: 403 });

    const alreadySubmitted = fight.arguments.find(
      (a) => a.agentId === agent.id && a.roundNumber === roundNum
    );
    if (alreadySubmitted) return NextResponse.json({ error: "Already submitted" }, { status: 400 });

    // Get or create round
    let round = fight.rounds.find((r) => r.roundNumber === roundNum);
    if (!round) {
      round = await prisma.round.create({
        data: { fightId: fight.id, roundNumber: roundNum },
      });
    }

    // Save argument
    await prisma.argument.create({
      data: {
        fightId: fight.id,
        roundId: round.id,
        agentId: agent.id,
        content: argument,
        roundNumber: roundNum,
      },
    });

    // Check if both submitted
    const roundArgs = await prisma.argument.findMany({
      where: { fightId: fight.id, roundNumber: roundNum },
    });

    if (roundArgs.length === 2) {
      // Both submitted — jury time
      const jury = await evaluateRound(
        fight.id,
        round.id,
        roundNum,
        roundArgs.map((a) => ({ agentId: a.agentId, content: a.content }))
      );

      await prisma.round.update({
        where: { id: round.id },
        data: {
          scoreA: jury.scoreA,
          scoreB: jury.scoreB,
          logicA: jury.details.logicA,
          logicB: jury.details.logicB,
          evidenceA: jury.details.evidenceA,
          evidenceB: jury.details.evidenceB,
          rebuttalA: jury.details.rebuttalA,
          rebuttalB: jury.details.rebuttalB,
          clarityA: jury.details.clarityA,
          clarityB: jury.details.clarityB,
          juryReasoning: jury.reasoning,
          completedAt: new Date(),
        },
      });

      if (roundNum >= fight.totalRounds) {
        await completeFight(fight.id);
        return NextResponse.json({
          message: "FIGHT OVER! Final round judged.",
          round_scores: { agentA: jury.scoreA, agentB: jury.scoreB },
          jury_reasoning: jury.reasoning,
          status: "COMPLETED",
        });
      } else {
        await prisma.fight.update({
          where: { id: fight.id },
          data: { currentRound: roundNum + 1 },
        });
        await prisma.round.create({
          data: { fightId: fight.id, roundNumber: roundNum + 1 },
        });

        return NextResponse.json({
          message: "Round complete! Next round ready.",
          round_scores: { agentA: jury.scoreA, agentB: jury.scoreB },
          jury_reasoning: jury.reasoning,
          next_round: roundNum + 1,
        });
      }
    }

    return NextResponse.json({
      message: "Argument submitted. Waiting for opponent.",
      round: roundNum,
    });
  } catch (error: any) {
    console.error("Submit error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
