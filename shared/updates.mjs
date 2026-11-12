// Update check: compares this build with the latest published GitHub release.
// It never downloads or runs anything; a newer release only opens its page.
export const RELEASE_REPO = 'Ranklywin/rankly-tweaks';
export const RELEASES_API = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
// Only this repository's release pages may be opened from an update notice.
const RELEASE_PAGE = /^https:\/\/github\.com\/ranklywin\/rankly-tweaks\/releases\/tag\/[A-Za-z0-9._-]{1,64}$/i;

export function parseVersion(value) {
  const match = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:[-+][0-9A-Za-z.-]{1,64})?$/.exec(String(value ?? '').trim());
  return match ? match.slice(1, 4).map(Number) : null;
}

export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

export function parseLatestRelease(release, current, checkedAt = new Date().toISOString()) {
  const none = { current, latest: null, newer: false, url: null, publishedAt: null, checkedAt };
  // GitHub's latest endpoint already skips drafts and prereleases; check again anyway.
  if (!release || typeof release !== 'object' || release.draft === true || release.prerelease === true) return none;
  const version = parseVersion(release.tag_name);
  if (!version) return none;
  const latest = version.join('.');
  const url = typeof release.html_url === 'string' && RELEASE_PAGE.test(release.html_url) ? release.html_url : null;
  const newer = Boolean(url) && compareVersions(latest, current) === 1;
  return { current, latest, newer, url: newer ? url : null, publishedAt: typeof release.published_at === 'string' ? release.published_at : null, checkedAt };
}
