import { useTaskCategories } from '../api';

/** A task's category as a small coloured label. */
export function CategoryChip({ categoryId }: { categoryId: string | null }) {
  const categories = useTaskCategories();
  const c = categoryId ? categories.data?.find((x) => x.id === categoryId) : null;
  if (!c) return null;
  return (
    <span className="category-chip" style={{ borderColor: c.color, color: c.color }}>
      <span className="category-dot" style={{ background: c.color }} />
      {c.name}
    </span>
  );
}

export function CategorySelect({
  value,
  onChange,
  emptyLabel = 'בלי קטגוריה',
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  emptyLabel?: string;
}) {
  const categories = useTaskCategories();
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{emptyLabel}</option>
      {categories.data?.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
