import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workspacePath = resolve("web-dashboard/frontend/src/features/workspace/Workspace.tsx");
const controlsPath = resolve("web-dashboard/frontend/src/components/ResearchControls.tsx");

const workspaceSource = readFileSync(workspacePath, "utf8");
const controlsSource = readFileSync(controlsPath, "utf8");

test("workspace module headers do not imply ordered sequence", () => {
  assert.ok(!workspaceSource.includes("01 / Material analysis"));
  assert.ok(!workspaceSource.includes("02 / Digestion"));
  assert.ok(!workspaceSource.includes("03 / Metal recovery"));
});

test("workspace payload matching is guarded by current payload readiness", () => {
  assert.ok(workspaceSource.includes("payloadReadyForMatch"));
  assert.ok(workspaceSource.includes("resultMatches = !!result && payloadReadyForMatch"));
  assert.ok(!workspaceSource.includes("Number(values[field.key])"));
});

test("ore agreement text does not default to agreement on malformed outputs", () => {
  assert.ok(controlsSource.includes("Agreement status was not returned with this record."));
  assert.ok(!controlsSource.includes("output.grade_disagreement === true"));
});

test("Li/Ga/Sc units are scoped to concentration rows", () => {
  assert.ok(controlsSource.includes("path[path.length - 1] !== \"bauxite_concentrations_ug_g\""));
});
