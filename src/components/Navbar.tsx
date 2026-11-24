import type { AppView } from '../types/echo';

interface NavbarProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
}

export function Navbar({ activeView, onNavigate }: NavbarProps) {
  const navItems: { id: AppView; label: string }[] = [
    { id: 'overview', label: 'Home' },
    { id: 'live', label: 'Live Coach' },
    { id: 'interview', label: 'Mock Interview' },
    { id: 'reports', label: 'Reports' },
    { id: 'about', label: 'About' },
  ];

  const isNavActive = (id: AppView) => {
    if (id === 'reports' && activeView === 'report-detail') return true;
    return activeView === id;
  };

  return (
    <header className="no-print sticky top-0 z-30 border-b border-white/[0.08] bg-[#070B09]/92 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1360px] items-center justify-between gap-8 px-6">
        {/* Zone 1: Single-line brand wordmark */}
        <button
          type="button"
          onClick={() => onNavigate('overview')}
          className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded-sm"
        >
          Echo
        </button>

        {/* Zone 2: 4 clean single-line text nav links */}
        <nav
          aria-label="Primary navigation"
          className="flex h-full items-center gap-6 text-sm font-medium"
        >
          {navItems.map((item) => {
            const active = isNavActive(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`relative flex h-full items-center whitespace-nowrap shrink-0 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded-sm ${
                  active
                    ? 'text-white'
                    : 'text-[#93A49B] hover:text-[#E2ECE6]'
                }`}
              >
                {item.label}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-[2px] bg-emerald-400"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary CTA */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('live')}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-[#04120B] transition-colors duration-150 hover:bg-emerald-400 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          >
            Start Session
          </button>
        </div>
      </div>
    </header>
  );
}
