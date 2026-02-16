import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/lib/auth";

export async function POST(req: NextRequest, { params }: { params: { fightId: string } }) {
  try {
    const agent = await authenticateAgent(req);
    if (!agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const fight = await prisma.fight.findUnique({ where: { id: params.fightId } });
    if (!fight) return NextResponse.json({ error: "Fight not found" }, { status: 404 });
    if (fight.status !== "PENDING") return NextResponse.json({ error: "Fight not open" }, { status: 400 });
    if (fight.agentAId === agent.id) return NextResponse.json({ error: "Cannot fight yourself" }, { status: 400 });

    const updated = await prisma.fight.update({
      where: { id: params.fightId },
      data: { agentBId: agent.id, status: "ACTIVE", currentRound: 1 },
      include: { agentA: { select: { name: true } }, agentB: { select: { name: true } } },
    });

    await prisma.round.create({ data: { fightId: fight.id, roundNumber: 1 } });

    return NextResponse.json({
      fight_id: updated.id,
      status: "ACTIVE",
      message: `Fight accepted! ${updated.agentA.name} vs ${updated.agentB?.name}. Submit Round 1.`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
