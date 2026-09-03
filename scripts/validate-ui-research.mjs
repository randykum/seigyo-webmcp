#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const [, , dirArg = "ui_system/ui_research", minUiArg = "50", minLibArg = "25"] = process.argv;
const dir = path.resolve(dirArg);
const minUi = Number(minUiArg);
const minLibraries = Number(minLibArg);

const requiredFiles = [
  "research-index.json",
  "research-summary.md",
  "ui-inspiration-candidates.json",
  "component-library-research.json",
  "design-system-research.json",
  "source-map.csv",
];

function fail(message) {
  throw new Error(`UI research validation failed: ${message}`);
}

function readJson(fileName) {
  const file = path.join(dir, fileName);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`could not read ${fileName}: ${error.message}`);
  }
}

for (const fileName of requiredFiles) {
  const file = path.join(dir, fileName);
  if (!fs.existsSync(file)) fail(`missing ${fileName}`);
  if (fs.statSync(file).size === 0) fail(`empty ${fileName}`);
}

const index = readJson("research-index.json");
const candidates = readJson("ui-inspiration-candidates.json");
const libraries = readJson("component-library-research.json");
const designSystems = readJson("design-system-research.json");

if (!Array.isArray(candidates)) fail("ui-inspiration-candidates.json must be an array");
if (!Array.isArray(libraries)) fail("component-library-research.json must be an array");
if (!Array.isArray(designSystems)) fail("design-system-research.json must be an array");
if (candidates.length < minUi) fail(`need at least ${minUi} UI candidates, found ${candidates.length}`);
if (libraries.length < minLibraries) fail(`need at least ${minLibraries} libraries, found ${libraries.length}`);
if (designSystems.length < 5) fail(`need at least 5 design-system references, found ${designSystems.length}`);

const candidateFields = [
  "id",
  "source",
  "title",
  "url",
  "urlType",
  "category",
  "visualObservation",
  "observedLayout",
  "observedColors",
  "observedComponents",
  "observedInteraction",
  "evidence",
  "whatToBorrow",
  "whatToAvoid",
  "designSystemAreas",
  "fitScore",
];

const libraryFields = [
  "id",
  "name",
  "url",
  "framework",
  "stylingMethod",
  "strengths",
  "weaknesses",
  "accessibilityNotes",
  "adaptationDifficulty",
  "fitScore",
];

for (const candidate of candidates) {
  for (const field of candidateFields) {
    if (!(field in candidate)) fail(`candidate ${candidate.id ?? "(missing id)"} is missing ${field}`);
  }
  if (!/^https?:\/\//i.test(candidate.url)) fail(`candidate ${candidate.id} has an invalid source URL`);
  if (!Array.isArray(candidate.designSystemAreas) || candidate.designSystemAreas.length === 0) {
    fail(`candidate ${candidate.id} needs designSystemAreas`);
  }
  if (!Array.isArray(candidate.observedComponents) || candidate.observedComponents.length < 2) {
    fail(`candidate ${candidate.id} needs at least two observed components`);
  }
  if (!candidate.evidence || candidate.evidence.type !== "visual-note" || !candidate.evidence.note) {
    fail(`candidate ${candidate.id} must use a text-only visual-note evidence record`);
  }
  if (candidate.evidence.path || candidate.evidence.url) {
    fail(`candidate ${candidate.id} must not redistribute local or remote image evidence`);
  }
}

for (const library of libraries) {
  for (const field of libraryFields) {
    if (!(field in library)) fail(`library ${library.id ?? library.name ?? "(missing id)"} is missing ${field}`);
  }
}

const sourceCount = new Set(candidates.map((candidate) => candidate.source)).size;
if (sourceCount < 8) fail(`need at least 8 distinct UI inspiration sources, found ${sourceCount}`);

if (!index.counts || index.counts.uiCandidates !== candidates.length) {
  fail("research-index.json counts.uiCandidates must match the candidate count");
}
if (!index.counts || index.counts.componentLibraries !== libraries.length) {
  fail("research-index.json counts.componentLibraries must match the library count");
}
if (!index.counts || index.counts.visualEvidence !== 0) {
  fail("research-index.json counts.visualEvidence must be zero for the text-only library");
}
if (index.files?.report) fail("research-index.json must not reference a removed HTML report");

const sourceMap = fs.readFileSync(path.join(dir, "source-map.csv"), "utf8");
if (!/^id,type,source,title,url,/m.test(sourceMap)) fail("source-map.csv is missing its expected header");
if (sourceMap.trim().split(/\r?\n/).length < candidates.length + libraries.length + designSystems.length) {
  fail("source-map.csv does not contain all research records");
}

const evidenceDir = path.join(dir, "visual-evidence");
if (fs.existsSync(evidenceDir)) {
  const localImages = fs.readdirSync(evidenceDir, { recursive: true }).filter((name) =>
    /\.(png|jpe?g|webp|gif|svg)$/i.test(String(name)),
  );
  if (localImages.length > 0) fail("visual-evidence must not contain redistributed images");
}

const removedReferences = /visual-evidence|research-report|ui-\d{3}\.png/i;
for (const fileName of [
  "research-index.json",
  "research-summary.md",
  "ui-inspiration-candidates.json",
  "component-library-research.json",
  "design-system-research.json",
  "source-map.csv",
]) {
  if (removedReferences.test(fs.readFileSync(path.join(dir, fileName), "utf8"))) {
    fail(`${fileName} contains a reference to removed visual artifacts`);
  }
}

console.log(`UI research validation passed: ${candidates.length} candidates, ${libraries.length} libraries, text-only evidence.`);
