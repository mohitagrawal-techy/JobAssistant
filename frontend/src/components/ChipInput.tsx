import { type KeyboardEvent, useId, useState } from "react";

/** A list of short values entered as removable tags. Enter or a comma adds one. */
export function ChipInput({
  label,
  values,
  onChange,
  placeholder,
  testId,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  testId?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");

  const add = (text: string) => {
    const known = new Set(values.map((value) => value.toLowerCase()));
    const fresh = text
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value && !known.has(value.toLowerCase()));
    if (fresh.length) onChange([...values, ...new Set(fresh)]);
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      add(draft);
    } else if (event.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      <div
        className="mt-1 flex flex-wrap items-center gap-1.5 rounded-xl border-frame border-input bg-white p-2 focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-brand"
        data-testid={testId}
      >
        {values.map((value) => (
          <span key={value} className="flex items-center gap-1 rounded-pill bg-canvas py-0.5 pl-2.5 pr-1 text-xs font-medium text-ink">
            {value}
            <button
              type="button"
              aria-label={`Remove ${value}`}
              onClick={() => onChange(values.filter((item) => item !== value))}
              className="flex h-4 w-4 items-center justify-center rounded-full leading-none text-ink-soft hover:bg-white hover:text-ink"
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          className="min-w-32 flex-1 bg-transparent px-1 py-0.5 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-none"
          placeholder={values.length ? "Add another" : placeholder}
          value={draft}
          onChange={(event) => (event.target.value.includes(",") ? add(event.target.value) : setDraft(event.target.value))}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
        />
      </div>
    </div>
  );
}
