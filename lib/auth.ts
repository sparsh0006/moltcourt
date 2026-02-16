// lib/auth.ts
import { NextRequest } from "next/server";
import { prisma } from "./prisma";

export async function authenticateAgent(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const apiKey = authHeader.replace("Bearer ", "");
  return prisma.agent.findUnique({ where: { apiKey } });
}
