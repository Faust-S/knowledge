import { useDomainShell } from "./useDomainShell";

/**
 * Domain footer — driven by `layout.footerVariant`.
 *
 *  - "domain":   short name, descriptor, link home
 *  - "compact":  short name + link home
 *  - "none":     not rendered at all
 *
 * Never invent legal links, contacts or founding year that are not in
 * the configuration.
 */
export function DomainFooter() {
  const { brand, layout } = useDomainShell();
  if (layout.footerVariant === "none") return null;

  const homeLink = (
    <a
      href={brand.home_path}
      data-testid="domain-footer-home"
      className="text-slate-300 hover:text-slate-100 min-h-11 inline-flex items-center"
    >
      {brand.short_name}
    </a>
  );

  return (
    <footer
      data-testid="domain-footer"
      data-footer-variant={layout.footerVariant}
      className="border-t border-slate-800 px-3 sm:px-4 py-3 text-xs text-slate-400 flex flex-wrap items-center gap-2"
    >
      {homeLink}
      {layout.footerVariant === "domain" ? (
        <span data-testid="domain-footer-descriptor" className="truncate">
          · {brand.descriptor}
        </span>
      ) : null}
    </footer>
  );
}
