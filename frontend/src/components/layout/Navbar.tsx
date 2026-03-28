import { TreePine, Settings, Search } from 'lucide-react';
import { useState } from 'react';

interface NavbarProps {
    onOpenSettings: () => void;
    onSearch: (query: string) => void;
}

export default function Navbar({ onOpenSettings, onSearch }: NavbarProps) {
    const [query, setQuery] = useState('');

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        onSearch(query);
    };

    return (
        <nav className="navbar glass-panel">
            <div className="nav-brand" style={{ cursor: 'pointer' }} onClick={() => window.location.href = '/'}>
                <TreePine size={28} />
                <h1>Our Little Tribe</h1>
            </div>

            <form onSubmit={handleSearch} className="search-container" style={{ margin: '0 20px', flex: 1, maxWidth: '400px' }}>
                <Search size={20} className="search-icon" />
                <input
                    type="text"
                    placeholder="Search tribes, people, events..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
            </form>

            <div className="nav-actions">
                <button className="icon-btn" onClick={onOpenSettings} title="Settings">
                    <Settings size={24} />
                </button>
            </div>
        </nav>
    );
}
