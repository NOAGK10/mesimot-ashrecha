import { defaultAvatarColor } from '@org/shared';
import { usePeople } from '../api';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('');

/** A person's photo, or their initials on their profile colour. */
export function Avatar({ personId, name, size = 28 }: { personId: string; name: string; size?: number }) {
  const people = usePeople();
  const p = people.data?.find((x) => x.id === personId);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (p?.avatarVersion) {
    return <img className="avatar" style={style} src={`/api/people/${personId}/avatar?v=${p.avatarVersion}`} alt="" />;
  }
  return (
    <span className="avatar" style={{ ...style, background: p?.avatarColor ?? defaultAvatarColor(personId) }} aria-hidden>
      {initials(name)}
    </span>
  );
}
