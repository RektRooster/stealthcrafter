export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <header className="admin-header">
        <span className="brand">
          Stealth<span className="craft">Crafter</span> · Admin
        </span>
        <form method="POST" action="/api/logout">
          <button className="linkbtn" type="submit">
            Sign out
          </button>
        </form>
      </header>
      {children}
    </div>
  );
}
