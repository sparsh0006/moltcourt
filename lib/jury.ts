// lib/jury.ts
import { prisma } from "./prisma";

const JURY_SYSTEM_PROMPT = `You are a debate judge on MoltCourt, an arena for AI agent debates.

Score two arguments on four criteria (0.0–10.0 each):
1. LOGIC & REASONING: Sound argument structure? Fallacies?
2. EVIDENCE & SPECIFICITY: Concrete examples, data, real projects? Vague = low score.
3. REBUTTAL QUALITY: How well does agent counter opponent? (Score 5.0 for Round 1)
4. CLARITY & PERSUASION: Well-structured and compelling?

RULES:
- Score independently. Don't let one inflate/deflate the other.
- Reward intellectual honesty. Conceding a weak point > dodging.
- Penalize repetition from previous rounds.
- Be precise: 7.0 vs 7.5 matters.

Respond ONLY with JSON (no markdown, no backticks):
{"agentA":{"logic":0.0,"evidence":0.0,"rebuttal":0.0,"clarity":0.0},"agentB":{"logic":0.0,"evidence":0.0,"rebuttal":0.0,"clarity":0.0},"reasoning":"Brief explanation"}`;

interface JuryResult {
  scoreA: number;
  scoreB: number;
  details: {
    logicA: number; logicB: number;
    evidenceA: number; evidenceB: number;
    rebuttalA: number; rebuttalB: number;
    clarityA: number; clarityB: number;
  };
  reasoning: string;
}

export async function evaluateRound(
  fightId: string,
  roundId: string,
  roundNumber: number,
  args: Array<{ agentId: string; content: string }>
): Promise<JuryResult> {
  const fight = await prisma.fight.findUnique({
    where: { id: fightId },
    include: {
      agentA: true,
      agentB: true,
      rounds: { include: { arguments: true }, orderBy: { roundNumber: "asc" } },
    },
  });

  if (!fight || !fight.agentB) throw new Error("Fight not found or incomplete");

  const argA = args.find((a) => a.agentId === fight.agentAId);
  const argB = args.find((a) => a.agentId === fight.agentBId);
  if (!argA || !argB) throw new Error("Missing arguments");

  // Build previous round context
  const prevContext = fight.rounds
    .filter((r) => r.roundNumber < roundNumber && r.completedAt)
    .map((r) => {
      const rArgA = r.arguments.find((a) => a.agentId === fight.agentAId);
      const rArgB = r.arguments.find((a) => a.agentId === fight.agentBId);
      return `Round ${r.roundNumber}: A=${r.scoreA?.toFixed(1)}, B=${r.scoreB?.toFixed(1)}\nA: ${rArgA?.content.substring(0, 200)}...\nB: ${rArgB?.content.substring(0, 200)}...`;
    })
    .join("\n\n");

  const prompt = `TOPIC: ${fight.topic}\n\n${prevContext ? `PREVIOUS:\n${prevContext}\n\n` : ""}ROUND ${roundNumber}:\n\nAgent A (${fight.agentA.name}):\n${argA.content}\n\nAgent B (${fight.agentB.name}):\n${argB.content}\n\nScore both.`;

  // Call Anthropic API
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: JURY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Jury API failed: ${response.status} - ${err}`);
  }

  const data = await response.json();
  const text = data.content[0].text.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(text);

  const totalA = parsed.agentA.logic + parsed.agentA.evidence + parsed.agentA.rebuttal + parsed.agentA.clarity;
  const totalB = parsed.agentB.logic + parsed.agentB.evidence + parsed.agentB.rebuttal + parsed.agentB.clarity;

  return {
    scoreA: totalA,
    scoreB: totalB,
    details: {
      logicA: parsed.agentA.logic, logicB: parsed.agentB.logic,
      evidenceA: parsed.agentA.evidence, evidenceB: parsed.agentB.evidence,
      rebuttalA: parsed.agentA.rebuttal, rebuttalB: parsed.agentB.rebuttal,
      clarityA: parsed.agentA.clarity, clarityB: parsed.agentB.clarity,
    },
    reasoning: parsed.reasoning,
  };
}

export async function completeFight(fightId: string) {
  const fight = await prisma.fight.findUnique({
    where: { id: fightId },
    include: { rounds: true, agentA: true, agentB: true },
  });
  if (!fight || !fight.agentBId) return;

  const totalA = fight.rounds.reduce((s, r) => s + (r.scoreA || 0), 0);
  const totalB = fight.rounds.reduce((s, r) => s + (r.scoreB || 0), 0);
  const winnerId = totalA >= totalB ? fight.agentAId : fight.agentBId;
  const loserId = winnerId === fight.agentAId ? fight.agentBId : fight.agentAId;

  await prisma.fight.update({
    where: { id: fightId },
    data: { status: "COMPLETED", winnerId },
  });

  await prisma.agent.update({
    where: { id: winnerId },
    data: { wins: { increment: 1 }, reputation: { increment: 50 }, currentStreak: { increment: 1 } },
  });

  await prisma.agent.update({
    where: { id: loserId },
    data: { losses: { increment: 1 }, reputation: { decrement: 20 }, currentStreak: 0 },
  });
}
