// Workflow loader (SPEC Section 5.2)

import { readFileSync, watchFile, unwatchFile } from "node:fs";
import yaml from "js-yaml";
import type { WorkflowDefinition } from "./types.js";

export function loadWorkflow(path: string): WorkflowDefinition {
  const content = readFileSync(path, "utf-8");
  return parseWorkflow(content);
}

export function parseWorkflow(content: string): WorkflowDefinition {
  const lines = content.split(/\r?\n/);

  if (lines[0]?.trim() !== "---") {
    return { config: {}, promptTemplate: content.trim() };
  }

  const closingIdx = lines.indexOf("---", 1);
  if (closingIdx === -1) {
    return { config: {}, promptTemplate: content.trim() };
  }

  const frontMatterLines = lines.slice(1, closingIdx);
  const promptLines = lines.slice(closingIdx + 1);

  const frontMatterYaml = frontMatterLines.join("\n").trim();
  let config: Record<string, unknown> = {};

  if (frontMatterYaml) {
    const parsed = yaml.load(frontMatterYaml);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      config = parsed as Record<string, unknown>;
    } else if (parsed !== null && parsed !== undefined) {
      throw new Error("workflow_front_matter_not_a_map");
    }
  }

  return {
    config,
    promptTemplate: promptLines.join("\n").trim(),
  };
}

export function watchWorkflow(path: string, onChange: () => void): () => void {
  watchFile(path, { interval: 2000 }, () => {
    onChange();
  });
  return () => unwatchFile(path);
}
