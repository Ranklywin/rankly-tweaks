import { Globe, Youtube } from 'lucide-react';

export function SocialIcon({ id }: { id: string }) {
  if (id === 'rankly-website') return <Globe size={16} strokeWidth={1.7} aria-hidden="true" />;
  if (id === 'rankly-youtube') return <Youtube size={16} strokeWidth={1.7} aria-hidden="true" />;

  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    {id === 'rankly-x'
      ? <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-7.4L5.5 22H2.3l8.3-9.5L2.8 2h6.5l4.5 6.7L18.9 2Zm-1.1 18h1.7L8.3 3.9H6.5L17.8 20Z" />
      : <path d="M15 2h3a5.4 5.4 0 0 0 4 4.5v3.2a8.4 8.4 0 0 1-4-1.4v7.2a6.5 6.5 0 1 1-5.5-6.4v3.3a3.3 3.3 0 1 0 2.5 3.1V2Z" />}
  </svg>;
}
