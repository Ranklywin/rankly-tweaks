import { APP_VERSION } from '../shared/version.mjs';
import { RELEASES_API, parseLatestRelease } from '../shared/updates.mjs';

// One request to GitHub's public API. No account, identifier, or system data is sent.
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Rankly-Tweaks', 'X-GitHub-Api-Version': '2022-11-28' };
let pending = null;

export function checkForUpdate({ fetchImpl = globalThis.fetch, current = APP_VERSION, timeout = 10000 } = {}) {
  // Concurrent checks (startup plus a manual click) share one request.
  if (pending) return pending;
  pending = (async () => {
    let response;
    try { response = await fetchImpl(RELEASES_API, { headers, signal: AbortSignal.timeout(timeout) }); }
    catch { throw new Error('Could not reach GitHub to check for updates. Check your connection and try again.'); }
    // No published release yet.
    if (response.status === 404) return parseLatestRelease(null, current);
    if (response.status === 403 || response.status === 429) throw new Error('GitHub is limiting update checks right now. Try again later.');
    if (!response.ok) throw new Error('GitHub could not be checked for updates right now.');
    const text = await response.text();
    if (text.length > 1_000_000) throw new Error('GitHub returned an unexpected update response.');
    let release;
    try { release = JSON.parse(text); } catch { throw new Error('GitHub returned an unreadable update response.'); }
    return parseLatestRelease(release, current);
  })().finally(() => { pending = null; });
  return pending;
}
