// Fixed destinations shared by the renderer and the native external-link allowlist.
export const socials = Object.freeze([
  { id: 'rankly-website', name: 'Website', source: 'https://rankly.win/' },
  { id: 'rankly-x', name: 'X / Twitter', source: 'https://x.com/Rankly_win' },
  { id: 'rankly-tiktok', name: 'TikTok', source: 'https://www.tiktok.com/@rankly_win' },
  { id: 'rankly-youtube', name: 'YouTube', source: 'https://www.youtube.com/@Rankly_win' },
].map(social => Object.freeze(social)));
