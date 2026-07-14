export function FormField({
  label,
  name,
  defaultValue,
  type = "text",
  required,
  maxLength,
  autoComplete,
  min,
  max,
  step,
  list,
  onChange,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  required?: boolean;
  maxLength?: number;
  autoComplete?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  list?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-xs font-semibold uppercase tracking-wide text-text-soft">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue ?? undefined}
        required={required}
        maxLength={maxLength}
        autoComplete={autoComplete}
        min={min}
        max={max}
        step={step}
        list={list}
        onChange={onChange}
        className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
      />
    </div>
  );
}
