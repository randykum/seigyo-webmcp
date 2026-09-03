#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const [, , modeArg = "final", dirArg = "ui_system/design_systems"] = process.argv;
const mode = modeArg.toLowerCase();
const dir = path.resolve(dirArg);

const requiredByMode = {
  proposal: ["proposal.html", "proposal-options.json", "choices.csv", "choices.json"],
  final: [
    "index.html",
    "design-system.json",
    "tokens.css",
    "guidelines.md",
    "component-rules.md",
    "implementation-notes.md",
  ],
};

function fail(message) {
  throw new Error(`Design-system validation failed: ${message}`);
}

if (!requiredByMode[mode]) fail("mode must be proposal or final");

for (const fileName of requiredByMode[mode]) {
  const file = path.join(dir, fileName);
  if (!fs.existsSync(file)) fail(`missing ${fileName}`);
  if (fs.statSync(file).size === 0) fail(`empty ${fileName}`);
}

const filesToScan = mode === "proposal"
  ? ["proposal.html", "proposal-options.json"]
  : ["index.html", "design-system.json", "tokens.css", "guidelines.md", "component-rules.md", "implementation-notes.md"];
const removedReferences = /visual-evidence|research-report|ui-\d{3}\.png/i;
for (const fileName of filesToScan) {
  if (removedReferences.test(fs.readFileSync(path.join(dir, fileName), "utf8"))) {
    fail(`${fileName} contains a reference to removed visual artifacts`);
  }
}

if (mode === "proposal") {
  const options = JSON.parse(fs.readFileSync(path.join(dir, "proposal-options.json"), "utf8"));
  const html = fs.readFileSync(path.join(dir, "proposal.html"), "utf8");
  if (!Array.isArray(options.sections) || options.sections.length < 10) {
    fail("proposal must contain at least 10 design-system sections");
  }
  let totalOptions = 0;
  for (const section of options.sections) {
    if (!Array.isArray(section.options) || section.options.length < 3) {
      fail(`section ${section.id ?? section.title} has fewer than three options`);
    }
    totalOptions += section.options.length;
    if (!section.agentRecommendation) fail(`section ${section.id ?? section.title} is missing agentRecommendation`);
    for (const option of section.options) {
      if (!Array.isArray(option.researchEvidence) || option.researchEvidence.length === 0) {
        fail(`option ${option.id ?? option.name} is missing researchEvidence`);
      }
      if (!option.visualPreview?.sample || !option.visualPreview?.notes) {
        fail(`option ${option.id ?? option.name} needs a text-only visualPreview record`);
      }
      if (Object.hasOwn(option.visualPreview, "image")) {
        fail(`option ${option.id ?? option.name} must not reference image evidence`);
      }
      if (option.status === "recommended" && !option.recommendationReason) {
        fail(`recommended option ${option.id ?? option.name} needs recommendationReason`);
      }
    }
  }
  if (totalOptions < options.sections.length * 5) fail("proposal should average at least five options per section");
  if (!/choices-preview|data-choice|<input\b|<select\b/i.test(html)) {
    fail("proposal.html must include interactive or copyable choice controls");
  }
  if (!/dashboard/i.test(html) || !/form/i.test(html) || !/table/i.test(html)) {
    fail("proposal.html must include dashboard, form, and table sample UI");
  }
  if (/<img\b/i.test(html)) fail("proposal.html must remain text-only for visual research evidence");
  const researchDir = path.resolve(dir, "..", "ui_research");
  for (const fileName of [
    "research-index.json",
    "ui-inspiration-candidates.json",
    "component-library-research.json",
    "design-system-research.json",
  ]) {
    if (!fs.existsSync(path.join(researchDir, fileName))) fail(`missing research gate file ${fileName}`);
  }
}

if (mode === "final") {
  const system = JSON.parse(fs.readFileSync(path.join(dir, "design-system.json"), "utf8"));
  for (const key of ["project", "tokens", "selectedOptions", "rules"]) {
    if (!(key in system)) fail(`design-system.json is missing ${key}`);
  }
}

console.log(`Design system ${mode} validation passed.`);
