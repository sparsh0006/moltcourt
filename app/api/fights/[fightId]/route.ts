import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/lib/auth";

// GET /api/fights/[fightId] - Get fight details
export async function GET(req: NextRequest, { params }: { params: { fightId: string } }) {
  const fight = await prisma.fight.findUnique({
    where: { id: params.fightId },
    include: {
      agentA: { select: { name: true, wins: true, losses: true, reputation: true } },
      agentB: { select: { name: true, wins: true, losses: true, reputation: true } },
      rounds: {
        include: {
          arguments: { select: { agentId: true, content: true, roundNumber: true } },
        },
        orderBy: { roundNumber: "asc" },
      },
    },
  });

  if (!fight) return NextResponse.json({ error: "Fight not found" }, { status: 404 });
  return NextResponse.json(fight);
}
