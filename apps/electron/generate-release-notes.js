#!/usr/bin/env node

/**
 * Generates a GitHub Release body from apps/ui/src/data/changelog.json,
 * matching the entry whose "version" equals v<package.json version>.
 *
 * Writes apps/electron/release-notes.md and sets the `found` step output
 * (true/false) so the workflow can fall back to auto-generated notes when
 * there's no matching changelog entry (e.g. a hotfix released without one).
 */

const fs = require('fs');
const path = require('path');

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
const tag = `v${packageJson.version}`;

const changelogPath = path.join(__dirname, '../ui/src/data/changelog.json');
const changelog = JSON.parse(fs.readFileSync(changelogPath, 'utf-8'));
const entry = changelog.find((e) => e.version === tag);

const outputPath = path.join(__dirname, 'release-notes.md');
const githubOutput = process.env.GITHUB_OUTPUT;

function setOutput(found) {
  if (githubOutput) fs.appendFileSync(githubOutput, `found=${found}\n`);
}

if (!entry) {
  console.warn(`No changelog entry found for ${tag} — release will use auto-generated notes.`);
  fs.writeFileSync(outputPath, '');
  setOutput(false);
  process.exit(0);
}

const sections = Object.entries(entry.changes || {})
  .map(([heading, items]) => `### ${heading}\n${items.map((i) => `- ${i}`).join('\n')}`)
  .join('\n\n');

const body = `## ${entry.title}\n\n${entry.description}\n\n${sections}\n`;

fs.writeFileSync(outputPath, body);
setOutput(true);
console.log(`Wrote release-notes.md from changelog entry ${tag}`);
