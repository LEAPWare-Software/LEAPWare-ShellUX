#!/usr/bin/env node
// Rollout QA row C-92 (docs/proof-of-completion.md rollout step 2, case i): a
// throwaway repo row whose check makes a real network call. Expected to fail
// under the `unshare --net` wrapper on the CI runner (network blocked); local
// runs are unrestricted and this may pass there.
try {
  const res = await fetch('https://api.github.com');
  if (res && res.status) {
    console.log('network_ok=1');
  } else {
    console.error('rollout-case-i-network: fetch returned no usable response');
    process.exit(1);
  }
} catch (err) {
  console.error(`rollout-case-i-network: network call failed: ${err.message}`);
  process.exit(1);
}
