import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { Sparkles, Settings, Database, Sun, Moon } from 'lucide-react';
import { useState } from 'react';

const navItems = [
    { path: '/', label: 'Agent', icon: Sparkles },
    { path: '/settings', label: 'Settings', icon: Settings },
    { path: '/knowledge', label: 'Knowledge', icon: Database },
];

export default function Layout() {
    const [isDark, setIsDark] = useState(true);
    const location = useLocation();

    return (
        <div className="flex h-screen overflow-hidden bg-bg-primary text-text-primary">
            {/* Sidebar */}
            <aside
                className="w-[240px] flex flex-col border-r border-border shrink-0 bg-[rgba(5,6,12,0.6)] backdrop-blur-[20px]"
            >
                {/* Logo */}
                <div className="p-5 flex items-center gap-3">
                    <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center bg-gradient-to-br from-accent to-accent-light"
                    >
                        <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-lg font-semibold bg-gradient-to-br from-accent to-accent-light bg-clip-text text-transparent">
                        Opus
                    </span>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-3 py-2 space-y-1">
                    {navItems.map((item) => {
                        const isActive =
                            item.path === '/'
                                ? location.pathname === '/' || location.pathname.startsWith('/run')
                                : location.pathname === item.path;

                        return (
                            <NavLink
                                key={item.path}
                                to={item.path}
                                className={`flex items-center gap-3 px-3 py-3 mx-2 rounded-lg transition-all duration-200 text-sm border-l-2 ${
                                    isActive
                                        ? 'bg-[rgba(124,58,237,0.1)] text-white border-accent font-semibold'
                                        : 'text-text-secondary border-transparent font-medium hover:bg-white/5'
                                }`}
                            >
                                <item.icon className="w-[18px] h-[18px]" />
                                {item.label}
                            </NavLink>
                        );
                    })}
                </nav>

                {/* Bottom Section */}
                <div className="p-3 border-t border-border">
                    <button
                        onClick={() => setIsDark(!isDark)}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg w-full transition-all duration-200 text-sm text-text-secondary hover:bg-bg-surface"
                    >
                        {isDark ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
                        {isDark ? 'Light Mode' : 'Dark Mode'}
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-auto">
                <Outlet />
            </main>
        </div>
    );
}
