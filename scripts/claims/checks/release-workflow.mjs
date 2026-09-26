#!/usr/bin/env node
// Row C-51: `.github/workflows/release.yml` runs `verify` before packaging,
// packages Windows only (D-26) and drafts a GitHub Release, uploading the
// installer and blockmap before the manifest (RELEASE.md §2.4).
// `.github/workflows/desktop.yml` keeps its non-publishing shape and its macOS
// leg, unchanged.
import { readFileSync } from 'node:fs';
import YAML from 'yaml';

const release = YAML.parse(readFileSync('.github/workflows/release.yml', 'utf8'));
const desktop = YAML.parse(readFileSync('.github/workflows/desktop.yml', 'utf8'));

const triggersOnVTags = JSON.stringify(release.on?.push?.tags ?? []) === JSON.stringify(['v*']);

const jobs = release.jobs ?? {};
const jobIds = Object.keys(jobs);
const verifyJob = jobs[jobIds.find((id) => (jobs[id].steps ?? []).some((s) => s.run === 'npm run verify')) ?? ''];
const runsVerifyFirst = Boolean(verifyJob);

const packageJobId = jobIds.find((id) => (jobs[id].needs ?? []) === 'verify' || (jobs[id].needs ?? []).includes?.('verify'));
const packageJob = jobs[packageJobId ?? ''] ?? {};
const packageWindowsOnly = packageJob['runs-on'] === 'windows-latest';

const steps = (packageJob.steps ?? []).map((s) => s.run ?? '').join('\n---\n');
const createsDraft = /gh release create[\s\S]*--draft/.test(steps);
const idxCreate = steps.indexOf('gh release create');
const idxInstaller = steps.indexOf('gh release upload');
const idxInstallerFiles = /gh release upload[\s\S]*?release\/\*\.exe[\s\S]*?release\/\*\.blockmap/.test(steps);
const idxLatestUpload = steps.lastIndexOf('gh release upload');
const idxLatestFile = steps.indexOf('release/latest.yml');
const uploadOrderCorrect = idxCreate !== -1 && idxInstaller !== -1 && idxInstaller < idxLatestUpload && idxLatestFile > idxInstallerFiles;

const noMacInRelease = !JSON.stringify(release).includes('macos');

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const desktopStillNonPublishing =
  packageJson.scripts?.['package:desktop']?.includes('--publish never') &&
  JSON.stringify(desktop.jobs?.package?.steps ?? []).includes('verify:desktop');
const desktopKeepsMacosLeg = JSON.stringify(desktop.jobs?.package?.strategy?.matrix?.os ?? []).includes('macos-latest');

console.log(`triggers_on_v_tags=${triggersOnVTags ? 1 : 0}`);
console.log(`runs_verify_first=${runsVerifyFirst ? 1 : 0}`);
console.log(`package_windows_only=${packageWindowsOnly ? 1 : 0}`);
console.log(`creates_draft_release=${createsDraft ? 1 : 0}`);
console.log(`upload_order_correct=${uploadOrderCorrect ? 1 : 0}`);
console.log(`no_macos_in_release_yml=${noMacInRelease ? 1 : 0}`);
console.log(`desktop_still_non_publishing=${desktopStillNonPublishing ? 1 : 0}`);
console.log(`desktop_keeps_macos_leg=${desktopKeepsMacosLeg ? 1 : 0}`);
