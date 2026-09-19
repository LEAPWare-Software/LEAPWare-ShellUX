#!/usr/bin/env node
// Row C-42 (plan step 6b): the manifest carries a sha512 of the bundle, install refuses
// a mismatch, and serving refuses a bundle that has been rewritten on disk since install
// (rehash-on-serve). Each is pinned by a named test. Reads the tree only; builtins only.
import { existsSync, readFileSync } from 'node:fs';

const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
const pkg = read('electron/main/plugins/pluginPackage.ts');
const store = read('electron/main/plugins/pluginStore.ts');
const packageTest = read('electron/__tests__/pluginPackage.test.ts');
const schemeTest = read('electron/__tests__/pluginScheme.test.ts');

console.log(`manifest_declares_sha512=${/readonly sha512: string/.test(pkg) ? 1 : 0}`);
console.log(`install_refuses_mismatch=${/sha512Base64\(bundle\) !== manifest\.sha512/.test(pkg) ? 1 : 0}`);
console.log(`serve_rehashes_bundle=${/sha512Base64\(read\.bytes\) !== record\.sha512/.test(store) ? 1 : 0}`);
console.log(`install_mismatch_test=${/it\('refuses a package whose bundle does not match its manifest sha512'/.test(packageTest) ? 1 : 0}`);
console.log(`serve_mismatch_test=${/it\('refuses to serve an entry changed on disk after install'/.test(schemeTest) ? 1 : 0}`);
console.log(`entry_point_validation_named=${/ENTRY-POINT VALIDATION/.test(pkg) ? 1 : 0}`);
