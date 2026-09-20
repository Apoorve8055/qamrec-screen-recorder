/**
 * Shared form controls (Qamrec design system)
 */
import type { CSSProperties, ReactNode } from 'react';

/** The on/off lever. Gradient glow = on (never red). `size="lg"` is the lead lever of a group. */
export function Lever({
  checked,
  onChange,
  disabled = false,
  size = 'sm',
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'lg';
  label?: string;
}) {
  const lg = size === 'lg';
  // A lever that can't be used never glows, even if its setting is on
  const on = checked && !disabled;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative flex flex-shrink-0 items-center rounded-full p-[2px] transition-all duration-300 disabled:cursor-default ${
        lg ? 'h-6 w-[42px]' : 'h-[18px] w-8'
      } ${
        on
          ? lg
            ? 'bg-accent shadow-glow'
            : 'bg-paper'
          : 'bg-line'
      }`}
    >
      <span
        className={`flex items-center justify-center rounded-full shadow-[0_1px_4px_rgba(0,0,0,0.4)] transition-transform duration-300 ${
          lg ? 'h-5 w-5 bg-white' : `h-3.5 w-3.5 ${on ? 'bg-ink' : 'bg-fog/70'}`
        } ${checked ? (lg ? 'translate-x-[18px]' : 'translate-x-[14px]') : 'translate-x-0'}`}
      >
        {lg && <span className={`h-1 w-1 rounded-full ${on ? 'bg-violet' : 'bg-fog/40'}`} />}
      </span>
    </button>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
  hint,
  lead = false,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
  /** The main switch of a section: larger gradient lever, stronger label */
  lead?: boolean;
}) {
  return (
    // A label so the text and hint are part of the hit target, not just the small lever
    <label className={`flex items-center justify-between gap-3 py-1.5 ${disabled ? 'cursor-default opacity-40' : 'cursor-pointer'}`}>
      <span className="min-w-0">
        <span className={lead ? 'text-[12px] font-semibold text-paper' : 'text-[11px] text-paper/80'}>{label}</span>
        {hint && <span className="mt-0.5 block font-mono text-[10px] leading-snug text-fog/50">{hint}</span>}
      </span>
      <Lever checked={checked} onChange={onChange} disabled={disabled} size={lead ? 'lg' : 'sm'} label={label} />
    </label>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v) => String(v),
  disabled = false,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
  hint?: string;
}) {
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <label className={`block py-1 ${disabled ? 'opacity-40' : ''}`}>
      <span className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fog/60">{label}</span>
        <span className="rounded border border-line bg-ink px-1.5 py-0.5 font-mono text-[10px] text-fog">
          {format(value)}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="range"
        style={{ '--fill': fill } as CSSProperties}
      />
      {hint && <span className="block font-mono text-[10px] text-fog/40">{hint}</span>}
    </label>
  );
}

/** Pill group; the active option is a solid paper pill */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled = false,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex gap-1 rounded-full border border-line bg-ink p-0.5 ${disabled ? 'opacity-40' : ''}`}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          disabled={disabled}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-full px-2 py-1 text-[11px] font-medium transition-colors ${
            o.value === value ? 'bg-paper text-ink' : 'text-fog/70 hover:text-paper'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between py-1.5 text-[11px] text-paper/80">
      {label}
      <span className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase text-fog/60">{value}</span>
        <span className="relative h-6 w-6 overflow-hidden rounded-full border border-line-strong">
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute -inset-2 h-10 w-10 cursor-pointer border-0 bg-transparent p-0"
          />
        </span>
      </span>
    </label>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-b border-line/60 px-4 py-4">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="label-mono">{title}</h3>
        {action}
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

/** Segmented audio meter: gradient cells for system audio, white for the mic */
export function LevelMeter({ label, level, tone = 'accent' }: { label: string; level: number | null; tone?: 'accent' | 'white' }) {
  if (level === null) return null;
  const lit = Math.round(Math.min(1, level) * 12);
  return (
    <div className="flex items-center gap-2" role="meter" aria-label={`${label} level`} aria-valuenow={Math.round(level * 100)}>
      <span className="w-7 font-mono text-[8px] uppercase text-white/40">{label}</span>
      <div className="flex h-1.5 w-[84px] gap-[2px] overflow-hidden rounded-full bg-white/10 p-[1px]">
        {Array.from({ length: 12 }, (_, i) => (
          <span
            key={i}
            className={`flex-1 rounded-full transition-colors duration-100 ${
              i < lit ? (tone === 'accent' ? 'bg-accent-b' : 'bg-white') : 'bg-white/10'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
