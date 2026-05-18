import { useState } from 'react';
import { LogOut, TreePine, Users } from 'lucide-react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import type { User, Tribe } from '../types';

interface TribesViewProps {
    user: User | null;
    tribes: Tribe[];
    isCreatingTribe: boolean;
    setIsCreatingTribe: (val: boolean) => void;
    newTribeName: string;
    setNewTribeName: (val: string) => void;
    newTribeDesc: string;
    setNewTribeDesc: (val: string) => void;
    onCreateTribe: (e: React.FormEvent) => Promise<void>;
    onJoinTribe: (id: string) => Promise<void>;
    onLeaveTribe: (id: string) => Promise<void>;
    onLogin: () => void;
}

export default function TribesView({
    user, tribes, isCreatingTribe, setIsCreatingTribe,
    newTribeName, setNewTribeName, newTribeDesc, setNewTribeDesc,
    onCreateTribe, onJoinTribe, onLeaveTribe, onLogin
}: TribesViewProps) {
    const [selectedTribe, setSelectedTribe] = useState<Tribe | null>(null);

    return (
        <div className="view" style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-lg)' }}>
                <h2>Tribes</h2>
                {user && (
                    <button className="btn btn-primary" style={{ padding: '8px 16px' }} onClick={() => setIsCreatingTribe(!isCreatingTribe)}>
                        {isCreatingTribe ? 'Cancel' : <><Users size={16} className="mr-2" /> Create</>}
                    </button>
                )}
            </div>

            {isCreatingTribe && user && (
                <form onSubmit={onCreateTribe} className="glass-panel" style={{ padding: '20px', borderRadius: 'var(--radius-md)', marginBottom: 'var(--spacing-lg)', maxWidth: '600px', margin: '0 auto' }}>
                    <h3 style={{ marginBottom: '16px', color: 'var(--color-primary)' }}>Form a New Tribe</h3>
                    
                    <div className="form-group mb-3">
                        <label className="subtitle" style={{ display: 'block', marginBottom: '4px' }}>Tribe Name</label>
                        <div className="search-container" style={{ background: 'rgba(0,0,0,0.2)' }}>
                            <input
                                type="text"
                                placeholder="Seattle Hikers"
                                value={newTribeName}
                                onChange={e => setNewTribeName(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="form-group mb-4">
                        <label className="subtitle" style={{ display: 'block', marginBottom: '4px' }}>What is this tribe about?</label>
                        <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                            <ReactQuill
                                theme="snow"
                                value={newTribeDesc}
                                onChange={setNewTribeDesc}
                                style={{ height: '180px', color: 'var(--color-text)' }}
                            />
                        </div>
                    </div>

                    <div style={{ marginTop: '50px' }}>
                        <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Form Tribe</button>
                    </div>
                </form>
            )}

            {!user ? (
                <div className="empty-state">
                    <LogOut size={64} className="empty-icon" />
                    <p>Log in to discover and join tribes.</p>
                    <button className="btn btn-primary mt-4" onClick={onLogin}>Log In</button>
                </div>
            ) : tribes.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {tribes.map(tribe => (
                        <div key={tribe.id} className="glass-panel" style={{ padding: '20px', borderRadius: 'var(--radius-md)', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                                <div style={{ cursor: 'pointer', flex: 1, minWidth: 0 }} onClick={() => setSelectedTribe(tribe)}>
                                    <h3 style={{ color: 'var(--color-text)', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tribe.name}</h3>
                                    <div className="ql-snow" style={{ marginTop: '4px', marginBottom: '8px' }}>
                                        <div 
                                            className="ql-editor subtitle" 
                                            style={{ 
                                                padding: 0,
                                                fontSize: '0.9rem', 
                                                overflow: 'hidden', 
                                                textOverflow: 'ellipsis', 
                                                display: '-webkit-box',
                                                WebkitLineClamp: 2,
                                                WebkitBoxOrient: 'vertical',
                                                whiteSpace: 'normal',
                                                maxWidth: '100%', 
                                                wordBreak: 'break-word', 
                                                overflowWrap: 'anywhere',
                                                lineHeight: '1.4'
                                            }}
                                            dangerouslySetInnerHTML={{ __html: tribe.description || '' }}
                                        />
                                    </div>
                                    <p style={{ fontSize: '0.8rem', color: 'var(--color-primary-dark)', marginTop: '4px' }}>
                                        <Users size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                                        {tribe.member_count || 1} Members
                                    </p>
                                </div>

                                <div style={{ flexShrink: 0 }}>
                                    {tribe.is_member ? (
                                        <button
                                            className="btn btn-secondary"
                                            style={{ padding: '6px 14px', fontSize: '0.9rem', borderColor: 'var(--color-error)', color: 'var(--color-error)' }}
                                            onClick={(e) => { e.stopPropagation(); onLeaveTribe(tribe.id); }}
                                        >
                                            Leave
                                        </button>
                                    ) : (
                                        <button
                                            className="btn btn-secondary"
                                            style={{ padding: '6px 14px', fontSize: '0.9rem' }}
                                            onClick={(e) => { e.stopPropagation(); onJoinTribe(tribe.id); }}
                                        >
                                            Join
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="empty-state">
                    <TreePine size={64} className="empty-icon" />
                    <p>There are no tribes yet in your area.</p>
                    <button className="btn btn-secondary mt-2" onClick={() => setIsCreatingTribe(true)}>Be the first to form one</button>
                </div>
            )}

            {/* Tribe Details Modal Popup */}
            {selectedTribe && (
                <div
                    className="modal-overlay"
                    onClick={(e) => { if (e.target === e.currentTarget) setSelectedTribe(null); }}
                    style={{ backdropFilter: 'blur(8px)', zIndex: 1000 }}
                >
                    <div className="modal-content glass-panel" style={{ maxWidth: '600px', width: '90%', maxHeight: '85vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '24px' }}>
                        <div className="modal-header" style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h2 style={{ color: 'var(--color-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '85%' }}>{selectedTribe.name}</h2>
                            <button className="icon-btn" onClick={() => setSelectedTribe(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px' }}>
                                <span style={{ fontSize: '1.5rem', color: 'var(--color-text-muted)', lineHeight: 1 }}>&times;</span>
                            </button>
                        </div>

                        {/* Render rich text natively with wrap safety */}
                        <div 
                            className="tribe-description" 
                            style={{ 
                                color: 'var(--color-text)', 
                                lineHeight: '1.6', 
                                marginBottom: '24px',
                                wordBreak: 'break-word',
                                overflowWrap: 'anywhere'
                            }} 
                            dangerouslySetInnerHTML={{ __html: selectedTribe.description || '' }} 
                        />

                        <div style={{ marginBottom: '15px', color: 'var(--color-primary-dark)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Users size={18} />
                            <span><strong>{selectedTribe.member_count || 1}</strong> members in this Tribe</span>
                        </div>

                        {selectedTribe.members && selectedTribe.members.length > 0 && (
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '30px', flexWrap: 'wrap' }}>
                                {selectedTribe.members.map(member => (
                                    <div key={member.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                        <img
                                            src={member.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + member.id}
                                            alt={member.name}
                                            title={member.name}
                                            style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--color-primary)' }}
                                            onError={(e) => { e.currentTarget.src = 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + member.id; }}
                                        />
                                        <span style={{ fontSize: '0.75rem', marginTop: '4px', color: 'var(--color-text-muted)', maxWidth: '60px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {member.name.split(' ')[0]}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '12px', marginTop: 'auto' }}>
                            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setSelectedTribe(null)}>Go Back</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
