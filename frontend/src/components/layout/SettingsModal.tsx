import { Search, X, LogOut, PersonStanding, Bell, Shield } from 'lucide-react';
import { useState } from 'react';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onLogout: () => void;
    onNavigate?: (view: 'profile' | 'notifications' | 'privacy') => void;
}

export default function SettingsModal({ isOpen, onClose, onLogout, onNavigate }: SettingsModalProps) {
    const [settingsSearch, setSettingsSearch] = useState('');

    const settingsItems = [
        { id: 'profile', icon: <PersonStanding />, title: 'Profile', subtitle: 'Edit your public account details', keywords: 'profile account name avatar update edit me' },
        { id: 'notifications', icon: <Bell />, title: 'Notifications', subtitle: 'Push alerts and activity preferences', keywords: 'notifications alerts push bell sound' },
        { id: 'privacy', icon: <Shield />, title: 'Privacy & Security', subtitle: 'Manage who sees your activities', keywords: 'privacy security data visibility block rules' }
    ];

    const filteredSettings = settingsItems.filter(item => item.keywords.includes(settingsSearch.toLowerCase()));

    return (
        <div
            className={`modal-overlay ${!isOpen ? 'hidden' : ''}`}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="modal-content glass-panel" style={{ transform: isOpen ? 'translateY(0)' : 'translateY(100%)' }}>
                <div className="modal-header">
                    <h2>Account Settings</h2>
                    <button className="icon-btn" onClick={onClose}><X size={24} /></button>
                </div>
                <div className="search-container">
                    <Search size={20} className="search-icon" />
                    <input
                        id="settings-search"
                        type="text"
                        placeholder="Search settings..."
                        value={settingsSearch}
                        onChange={(e) => setSettingsSearch(e.target.value)}
                        autoComplete="off"
                    />
                </div>
                <ul className="settings-list">
                    {filteredSettings.map(item => (
                        <li 
                            key={item.id} 
                            className="settings-item cursor-pointer hover:bg-white/5 transition-colors"
                            onClick={() => {
                                if (onNavigate) {
                                    onNavigate(item.id as any);
                                    onClose();
                                }
                            }}
                        >
                            {item.icon}
                            <div className="item-text">
                                <strong>{item.title}</strong>
                                <small>{item.subtitle}</small>
                            </div>
                        </li>
                    ))}

                    {('logout signout exit'.includes(settingsSearch.toLowerCase())) && (
                        <li className="settings-item" onClick={onLogout}>
                            <LogOut style={{ color: 'var(--color-error)' }} />
                            <div className="item-text">
                                <strong style={{ color: 'var(--color-error)' }}>Log Out</strong>
                                <small>Sign out of this device</small>
                            </div>
                        </li>
                    )}
                </ul>
            </div>
        </div>
    );
}
