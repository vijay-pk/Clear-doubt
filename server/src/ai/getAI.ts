import { env } from "../config/env.js";
import type { AIProvider } from "./types.js";
import { MockAIProvider } from "./mockProvider.js";
import { GroqAIProvider } from "./groqProvider.js";

let instance: AIProvider | null = null;

export function getAI(): AIProvider {
  if (!instance) {
    instance = env.AI_PROVIDER === "groq" ? new GroqAIProvider() : new MockAIProvider();
  }
  return instance;
}

// test hook
export function setAI(p: AIProvider) {
  instance = p;
}
