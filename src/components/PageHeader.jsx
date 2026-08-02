export function PageHeader({ title, description, actions }) {
  return (
    <header className="page-head">
      <div className="page-head__copy">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-head__actions">{actions}</div> : null}
    </header>
  );
}
