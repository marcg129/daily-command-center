import type { ReactNode } from "react";

export function WorkspacePageShell({
  eyebrow,
  title,
  description,
  icon,
  emptyTitle,
  emptyDescription,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: ReactNode;
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <div className="view workspace-page-shell">
      <div className="page-heading reveal">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="page-description">{description}</p>
        </div>
      </div>
      <section className="panel workspace-empty-state reveal delay-1">
        <span className="workspace-empty-icon">{icon}</span>
        <p className="eyebrow">Coming in a later milestone</p>
        <h2>{emptyTitle}</h2>
        <p>{emptyDescription}</p>
      </section>
    </div>
  );
}
