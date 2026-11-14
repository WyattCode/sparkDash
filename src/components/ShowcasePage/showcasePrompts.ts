/**
 * Showcase prompt catalogs by workload type.
 * Canonical lists live in src/shared/llmPrompts.js (also used by Decode bench).
 */

export type ShowcasePromptType = "structural" | "text" | "mixed";

export const PROMPT_TYPES: { id: ShowcasePromptType; label: string; hint: string }[] = [
  {
    id: "text",
    label: "文本",
    hint: "文章与叙事，不包含代码或结构化格式",
  },
  {
    id: "structural",
    label: "结构化",
    hint: "JSON、HTML、YAML、SQL、结构定义、表格和日志",
  },
  {
    id: "mixed",
    label: "混合",
    hint: "结构化与文本各半，交错排列",
  },
];

export {
  TEXT_PROMPTS,
  STRUCTURAL_PROMPTS,
  pickShowcasePrompts,
  withFillToMaxInstruction,
} from "../../shared/llmPrompts.js";
