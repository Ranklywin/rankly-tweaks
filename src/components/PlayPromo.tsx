// Promotes Rankly's Fortnite ranked matches and tournaments. Links open in the
// browser only when clicked; nothing here loads remote content or tracks usage.
import { ArrowRight, ArrowUpRight, X } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { playLinks } from '../../shared/socials.mjs';

export type PromoVariant = 'launch' | 'tuned';
type OpenLink = (id: string, event: MouseEvent<HTMLAnchorElement>) => void;

function PlayAnchor({ link, onOpen, className, children, title }: { link: { id: string; source: string }; onOpen: OpenLink; className: string; children: ReactNode; title?: string }) {
  return <a className={className} href={link.source} target="_blank" rel="noopener noreferrer" title={title} onClick={event => onOpen(link.id, event)}>{children}</a>;
}

export function PlayCard({ onOpen }: { onOpen: OpenLink }) {
  return <PlayAnchor link={playLinks.ranked.sidebar} onOpen={onOpen} className="play-card" title="Play free ranked Fortnite on Rankly">
    <img className="play-card-trophy" src="./rankly-trophy.png" alt="" aria-hidden="true" />
    <span className="play-card-copy">
      <strong className="play-card-title">Play ranked.<span> Win prizes.</span></strong>
    </span>
    <span className="play-card-cta"><span>Play now</span><ArrowUpRight size={14} strokeWidth={2} aria-hidden="true" /></span>
  </PlayAnchor>;
}

export function PlayPopup({ variant, raised, onOpen, onClose }: { variant: PromoVariant; raised: boolean; onOpen: OpenLink; onClose: () => void }) {
  const tuned = variant === 'tuned';
  const placement = tuned ? 'afterTweaks' : 'popup';
  return <aside className={`play-popup ${raised ? 'raised' : ''}`} aria-labelledby="play-popup-title">
    <div className="play-popup-art" aria-hidden="true">
      <span className="play-popup-glow" />
      <img src="./rankly-trophy.png" alt="" />
      <span className="play-popup-tags"><span>Free to play</span><span className="gold">Cash prizes</span></span>
    </div>
    <button className="play-popup-close" aria-label="Close Rankly invite" title="Not now" onClick={onClose}><X size={15} strokeWidth={1.8} /></button>
    <div className="play-popup-body">
      <span className="play-popup-eyebrow">{tuned ? 'Tweaks applied' : 'Fortnite on Rankly'}</span>
      <h3 id="play-popup-title">{tuned ? <>Your PC is tuned.<span> Now go win.</span></> : <>Play ranked.<span> Win prizes.</span></>}</h3>
      <p>{tuned ? 'Put it to the test in ranked Fortnite Boxfights, Realistics and Zone Wars.' : 'Free ranked Fortnite Boxfights, Realistics and Zone Wars.'}</p>
      <div className="play-popup-actions">
        <PlayAnchor link={playLinks.ranked[placement]} onOpen={onOpen} className="button primary">Play ranked<ArrowRight size={15} strokeWidth={2} aria-hidden="true" /></PlayAnchor>
        <PlayAnchor link={playLinks.tournaments[placement]} onOpen={onOpen} className="button secondary">Tournaments</PlayAnchor>
      </div>
      <span className="play-popup-fine">No entry fees · EU and NA servers</span>
    </div>
  </aside>;
}
