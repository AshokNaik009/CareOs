// Dark top bar used by the patient and provider apps.
export default function TopBar({ brand, active, children }) {
  return (
    <header className="topbar">
      <a className="brand" href="/">{brand}</a>
      <nav className="nav">
        <a className={active === 'patient' ? 'active' : undefined} href="/patient.html">Patient agent</a>
        <a className={active === 'provider' ? 'active' : undefined} href="/provider.html">Care OS</a>
      </nav>
      <div className="spacer"></div>
      {children}
    </header>
  );
}
