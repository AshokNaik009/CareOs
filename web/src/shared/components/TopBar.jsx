// Dark top bar used by the patient and provider apps.
export default function TopBar({ brand, active, children, contextId = 'P-1001', lang = 'en' }) {
  const patientId = ['P-1001', 'P-2002'].includes(contextId) ? contextId : 'P-1001';
  return (
    <header className="topbar">
      <a className="brand" href="/">{brand}</a>
      <nav className="nav" aria-label="Main navigation">
        <a className={active === 'patient' ? 'active' : undefined} aria-current={active === 'patient' ? 'page' : undefined} href={`/patient.html?p=${encodeURIComponent(patientId)}&lang=${lang}`}>Patient agent</a>
        <a className={active === 'provider' ? 'active' : undefined} aria-current={active === 'provider' ? 'page' : undefined} href={`/provider.html?m=${encodeURIComponent(contextId || 'P-1001')}`}>Care OS</a>
        <a className={active === 'live-health' ? 'active' : undefined} aria-current={active === 'live-health' ? 'page' : undefined} href="/live-health">Live Health</a>
      </nav>
      <div className="spacer"></div>
      {children}
    </header>
  );
}
