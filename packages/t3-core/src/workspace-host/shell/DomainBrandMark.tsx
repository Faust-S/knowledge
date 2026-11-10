import { useState, type CSSProperties } from "react";
import { useDomainShell } from "./useDomainShell";
import { isSafeShellAssetPath } from "./safe-shell-path";

export interface DomainBrandMarkProps {
  className?: string;
  style?: CSSProperties;
}

/**
 * Safe brand logo mark.
 *
 * - Uses `brand.logo_path` from domain-shell.json.
 * - Path safety is centralised in `safe-shell-path.ts`.
 * - Falls back to a text mark showing `brand.short_name` when the image
 *   fails to load or when the path is not safe.
 * - Never uses `profileDefinition.logoText` — the profile is a separate
 *   badge, not the domain brand identity.
 */
export function DomainBrandMark({ className, style }: DomainBrandMarkProps) {
  const { brand } = useDomainShell();
  const safe = isSafeShellAssetPath(brand.logo_path);
  const [failed, setFailed] = useState(false);

  const wrapCls =
    "inline-flex items-center justify-center h-8 min-w-8 px-2 rounded text-xs font-semibold" +
    (className ? ` ${className}` : "");

  if (!safe || failed) {
    return (
      <span
        aria-hidden="true"
        data-testid="domain-brand-mark"
        data-brand-mark-mode="text"
        className={`${wrapCls} bg-slate-800 text-slate-100`}
        style={style}
      >
        {brand.short_name}
      </span>
    );
  }

  return (
    <span
      data-testid="domain-brand-mark"
      data-brand-mark-mode="image"
      className={wrapCls}
      style={style}
    >
      <img
        src={brand.logo_path}
        alt=""
        aria-hidden="true"
        onError={() => setFailed(true)}
        className="h-6 w-auto"
      />
    </span>
  );
}
