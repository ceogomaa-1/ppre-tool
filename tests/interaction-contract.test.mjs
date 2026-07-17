import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const workspaceUrl = new URL("../app/workspace.tsx", import.meta.url);

test("every explicit UI button has an action", async () => {
  const workspace = await readFile(workspaceUrl, "utf8");
  const source = ts.createSourceFile("workspace.tsx", workspace, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const inactive = [];
  let buttonCount = 0;
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(source) === "button") {
        buttonCount += 1;
        const jsxAttributes = node.attributes.properties.filter(ts.isJsxAttribute);
        const attributes = new Set(jsxAttributes.map((attribute) => attribute.name.getText(source)));
        const typeAttribute = jsxAttributes.find((attribute) => attribute.name.getText(source) === "type");
        const typeValue = typeAttribute?.initializer && ts.isStringLiteral(typeAttribute.initializer) ? typeAttribute.initializer.text : null;
        if (typeValue === "button" && !attributes.has("onClick")) inactive.push(node.getText(source));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(buttonCount >= 25, "expected the complete interactive workspace");
  assert.deepEqual(inactive, []);
});

test("account, persistence, review, job, pagination, selection and export flows are wired", async () => {
  const workspace = await readFile(workspaceUrl, "utf8");
  for (const capability of [
    "signInWithOAuth",
    "signInWithOtp",
    "signOut",
    "refreshWorkspace",
    "updateLeadReview",
    "deleteLead",
    "deleteLeadsBulk",
    "createLeadRedoJob",
    "updateEnrichmentJob",
    "deleteDataset",
    "selectedLeadIds",
    "setPage",
    "exportCsv",
    "Export stopped:",
    "Delete all queued",
    "Delete all needs review",
    "Redo search",
    "Export all",
  ]) {
    assert.match(workspace, new RegExp(capability));
  }
});
