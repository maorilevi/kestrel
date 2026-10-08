import type { Breadcrumb } from '../state/view-state';

export interface BreadcrumbsProps {
  crumbs: Breadcrumb[];
  onNavigate: (crumb: Breadcrumb) => void;
}

/** KESTREL / <app> / <module> / <component> */
export function Breadcrumbs({ crumbs, onNavigate }: BreadcrumbsProps) {
  return (
    <nav className="kestrel-breadcrumbs" aria-label="Architecture level">
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        return (
          <span key={`${crumb.label}-${index}`} className="kestrel-breadcrumbs__item">
            <button
              type="button"
              className={`kestrel-breadcrumbs__link${isLast ? ' is-current' : ''}`}
              onClick={() => onNavigate(crumb)}
              disabled={isLast}
            >
              {crumb.label}
            </button>
            {isLast ? null : <span className="kestrel-breadcrumbs__separator">/</span>}
          </span>
        );
      })}
    </nav>
  );
}
