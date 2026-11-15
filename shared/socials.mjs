// Fixed destinations shared by the renderer and the native external-link allowlist.
export const socials = Object.freeze([
  { id: 'rankly-website', name: 'Website', source: 'https://rankly.win/' },
  { id: 'rankly-x', name: 'X / Twitter', source: 'https://x.com/Rankly_win' },
  { id: 'rankly-tiktok', name: 'TikTok', source: 'https://www.tiktok.com/@rankly_win' },
  { id: 'rankly-youtube', name: 'YouTube', source: 'https://www.youtube.com/@Rankly_win' },
].map(social => Object.freeze(social)));

// Rankly's Fortnite ranked matches and tournaments, promoted inside the app.
// Each placement has its own fixed link so rankly.win's traffic sources show
// which one brought the visit. The tags name the placement only: no user,
// device, or usage data.
const PLAY_TAGS = 'utm_source=rankly-tweaks&utm_medium=app&utm_campaign=play-invite';
const playLink = (page, placement) => Object.freeze({
  id: `rankly-${page}-${placement}`,
  source: `https://rankly.win/${page}?${PLAY_TAGS}&utm_content=${placement}`,
});
export const playLinks = Object.freeze({
  ranked: Object.freeze({
    sidebar: playLink('ranked', 'sidebar'),
    overview: playLink('ranked', 'overview'),
    popup: playLink('ranked', 'popup'),
    afterTweaks: playLink('ranked', 'after-tweaks'),
  }),
  tournaments: Object.freeze({
    popup: playLink('tournaments', 'popup'),
    afterTweaks: playLink('tournaments', 'after-tweaks'),
  }),
});
export const playLinkList = Object.freeze(Object.values(playLinks).flatMap(group => Object.values(group)));
