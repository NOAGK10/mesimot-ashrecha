import { Fragment, useRef, useState } from 'react';
import type { PersonDto } from '@org/shared';
import { useMe } from '../api';
import { PersonTag, usePeopleMap } from './common';

/** Keeps track of who was picked from the "@" list; only tags still in the text count. */
export function useTagging() {
  const [tagged, setTagged] = useState<Map<string, string>>(new Map()); // name → id
  return {
    onTag: (p: PersonDto) => setTagged((m) => new Map(m).set(p.displayName, p.id)),
    idsIn: (text: string) => [...tagged].filter(([name]) => text.includes(`@${name}`)).map(([, id]) => id),
  };
}

/**
 * A textarea where typing "@" opens a list of people to tag.
 * With `floatLabel` it renders as a floating-label field (as in the new task window).
 */
export function MentionTextarea({
  value,
  onChange,
  onTag,
  rows = 3,
  maxLength = 20000,
  floatLabel,
  ariaLabel,
}: {
  value: string;
  onChange: (text: string) => void;
  onTag: (p: PersonDto) => void;
  rows?: number;
  maxLength?: number;
  floatLabel?: string;
  ariaLabel?: string;
}) {
  const me = useMe();
  const people = usePeopleMap();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const candidates = people.list.filter((p) => p.active && p.role !== null && p.id !== me.data?.personId);
  const matches = query === null ? [] : candidates.filter((p) => p.displayName.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  const updateQuery = (text: string, caret: number) => {
    const m = /(?:^|\s)@([^\s@]{0,30})$/.exec(text.slice(0, caret));
    setQuery(m ? m[1]! : null);
    setActive(0);
  };

  const pick = (p: PersonDto) => {
    const el = ref.current!;
    const caret = el.selectionStart;
    const before = value.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${p.displayName} `);
    onChange(before + value.slice(caret));
    onTag(p);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };

  return (
    <div className={`mention-box${floatLabel ? ' float-field' : ''}`}>
      <textarea
        ref={ref}
        rows={rows}
        maxLength={maxLength}
        value={value}
        placeholder=" "
        aria-label={ariaLabel ?? floatLabel}
        onChange={(e) => {
          onChange(e.target.value);
          updateQuery(e.target.value, e.target.selectionStart);
        }}
        onClick={(e) => updateQuery(value, e.currentTarget.selectionStart)}
        onBlur={() => setQuery(null)}
        onKeyDown={(e) => {
          if (matches.length === 0) return;
          if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => (a + 1) % matches.length));
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => (a - 1 + matches.length) % matches.length));
          else if (e.key === 'Enter' || e.key === 'Tab') (e.preventDefault(), pick(matches[active]!));
          else if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), setQuery(null));
        }}
      />
      {floatLabel && <span>{floatLabel}</span>}
      {matches.length > 0 && (
        <ul className="mention-list below" role="listbox">
          {matches.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <button type="button" className={i === active ? 'active' : ''} onMouseDown={(e) => (e.preventDefault(), pick(p))}>
                <PersonTag avatarFor={p.id} name={p.displayName} jobTitle={p.jobTitle} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <small className="mention-hint">הקלדת @ מתייגת משתמש · המתויג יקבל התראה</small>
    </div>
  );
}

/** Shows text with "@Name" highlighted for people in the organisation. */
export function TextWithMentions({ text }: { text: string }) {
  const people = usePeopleMap();
  const names = people.list.map((p) => p.displayName).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length || !text.includes('@')) return <>{text}</>;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alternatives = names.map((n) => `@${esc(n)}`).join('|');
  const isMention = new RegExp(`^(${alternatives})$`);
  return (
    <>
      {text.split(new RegExp(`(${alternatives})`)).map((part, i) =>
        isMention.test(part) ? (
          <mark key={i} className="mention">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
