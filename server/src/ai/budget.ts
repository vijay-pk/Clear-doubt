import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

// Rough Groq pricing (USD per 1M tokens) for budget estimation only.
const PRICE_PER_MTOK = { prompt: 0.59, completion: 0.79 };

function todayKey(): string {
  return `ai_cost_${new Date().toISOString().slice(0, 10)}`;
}

export function estimateCostUsd(promptTokens: number, completionTokens: number): number {
  return (promptTokens * PRICE_PER_MTOK.prompt + completionTokens * PRICE_PER_MTOK.completion) / 1_000_000;
}

export async function getTodayCost(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: todayKey() } });
  return (row?.value as { usd?: number } | undefined)?.usd ?? 0;
}

// Returns false when today's spend already exceeds the daily budget.
export async function withinBudget(): Promise<boolean> {
  return (await getTodayCost()) < env.AI_DAILY_BUDGET_USD;
}

export async function recordUsage(promptTokens: number, completionTokens: number): Promise<void> {
  const usd = estimateCostUsd(promptTokens, completionTokens);
  const key = todayKey();
  try {
    const current = await getTodayCost();
    await prisma.setting.upsert({
      where: { key },
      create: { key, value: { usd } },
      update: { value: { usd: current + usd } },
    });
  } catch (err) {
    logger.warn({ err }, "failed to record ai usage");
  }
}
