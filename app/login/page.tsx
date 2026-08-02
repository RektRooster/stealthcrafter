export const dynamic = "force-dynamic";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="login-wrap">
      <form className="card" method="POST" action="/api/login">
        <h1>
          Stealth<span style={{ color: "var(--brass)" }}>Crafter</span>
        </h1>
        <p className="hint">Private admin. Enter the access password to continue.</p>
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoFocus autoComplete="current-password" />
        <button className="primary" type="submit">
          Enter
        </button>
        {error ? <p className="error">Incorrect password. Try again.</p> : null}
      </form>
    </div>
  );
}
