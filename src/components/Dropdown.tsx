import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

type Option = { value: string; label: string };
type DropdownProps = {
  id?: string;
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
};

export function Dropdown({ id, label, value, options, onChange, disabled = false, className = '' }: DropdownProps) {
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', time: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const selected = options.findIndex(option => option.value === value);
  const expanded = open && !disabled && options.length > 0;

  function show() {
    setActive(Math.max(0, selected));
    search.current = { text: '', time: 0 };
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
    setOpen(false);
  }

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useLayoutEffect(() => {
    if (!expanded) return;
    function place() {
      if (!trigger.current || !menu.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const edge = 8, gap = 6;
      const width = Math.min(Math.max(rect.width, 156), window.innerWidth - edge * 2);
      const below = window.innerHeight - rect.bottom - gap - edge;
      const above = rect.top - gap - edge;
      const desiredHeight = Math.min(menu.current.scrollHeight, 288);
      const flip = below < desiredHeight && above > below;
      const maxHeight = Math.max(0, Math.min(288, flip ? above : below));
      setPosition({
        width, maxHeight,
        left: Math.max(edge, Math.min(rect.left, window.innerWidth - width - edge)),
        top: flip ? Math.max(edge, rect.top - gap - Math.min(desiredHeight, maxHeight)) : rect.bottom + gap,
      });
    }
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    }
    function scroll(event: Event) {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', scroll, true);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', scroll, true);
      document.removeEventListener('pointerdown', outside);
    };
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const option = menu.current?.children[active] as HTMLElement | undefined;
    // Scroll only the popup, keeping the page and trigger in place.
    if (option && menu.current) {
      const top = option.offsetTop, bottom = top + option.offsetHeight;
      if (top < menu.current.scrollTop) menu.current.scrollTop = top;
      else if (bottom > menu.current.scrollTop + menu.current.clientHeight) menu.current.scrollTop = bottom - menu.current.clientHeight;
    }
  }, [active, expanded]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || !options.length) return;
    if (event.key === 'Tab') { setOpen(false); return; }
    if (event.key === 'Escape') {
      if (expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      return;
    }
    if (['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      search.current = { text: '', time: 0 };
      if (event.key === 'Enter' || event.key === ' ') {
        if (expanded) choose(active); else show();
      } else if (event.key === 'Home' || event.key === 'End') {
        setOpen(true);
        setActive(event.key === 'Home' ? 0 : options.length - 1);
      } else if (!expanded) show();
      else setActive(index => Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const text = (now - search.current.time < 700 ? search.current.text : '') + event.key.toLocaleLowerCase();
      search.current = { text, time: now };
      const prefix = [...text].every(char => char === text[0]) ? text[0] : text;
      const start = expanded ? active : Math.max(0, selected);
      const offset = prefix.length === 1 ? 1 : 0;
      for (let step = 0; step < options.length; step++) {
        const index = (start + step + offset) % options.length;
        if (options[index].label.toLocaleLowerCase().startsWith(prefix)) { setActive(index); break; }
      }
      setOpen(true);
    }
  }

  return <div className={`dropdown ${className}`}>
    <button ref={trigger} id={id} type="button" className="dropdown-trigger" role="combobox"
      aria-label={label} aria-haspopup="listbox" aria-expanded={expanded}
      aria-controls={expanded ? listId : undefined}
      aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
      disabled={disabled || !options.length} onKeyDown={onKeyDown}
      onClick={() => { if (expanded) setOpen(false); else show(); }} onBlur={() => setOpen(false)}>
      <span>{options[selected]?.label || 'Select an option'}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {expanded && createPortal(<div ref={menu} id={listId} className="dropdown-menu" role="listbox" aria-label={label} style={position}>
      {options.map((option, index) => <div key={option.value} id={`${listId}-${index}`} role="option"
        aria-selected={option.value === value} className={`dropdown-option ${index === active ? 'active' : ''}`}
        onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
        <span>{option.label}</span>{option.value === value && <Check size={13} aria-hidden="true" />}
      </div>)}
    </div>, document.body)}
  </div>;
}
