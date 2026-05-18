import { useState } from 'react';
import { LogOut, TreePine, Users, MapPin, CheckCircle, XCircle } from 'lucide-react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import type { User, Tribe, Event } from '../types';

interface TribesViewProps {
    user: User | null;
    tribes: Tribe[];
    events: Event[];
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
    onApproveEvent?: (eventId: string) => Promise<void>;
    onRsvpEvent?: (eventId: string, status: 'going' | 'not_going' | 'none') => Promise<void>;
}

export default function TribesView({
    user, tribes, events, isCreatingTribe, setIsCreatingTribe,
    newTribeName, setNewTribeName, newTribeDesc, setNewTribeDesc,
    onCreateTribe, onJoinTribe, onLeaveTribe, onLogin,
    onApproveEvent, onRsvpEvent
}: TribesViewProps) {
    const [selectedTribe, setSelectedTribe] = useState<Tribe | null>(null);
    const [viewingTribeEvents, setViewingTribeEvents] = useState<Tribe | null>(null);
    const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);

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
            ) : viewingTribeEvents ? (
                <div>
                    <button 
                        className="btn btn-secondary" 
                        onClick={() => setViewingTribeEvents(null)}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}
                    >
                        👈 Back to Tribes List
                    </button>
                    
                    <h3 style={{ marginBottom: '16px', color: 'var(--color-primary)' }}>
                        Events for {viewingTribeEvents.name}
                    </h3>
                    
                    {events.filter(e => e.tribe_id === viewingTribeEvents.id).length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {events
                                .filter(e => e.tribe_id === viewingTribeEvents.id)
                                .map(event => (
                                    <div key={event.id} className="glass-panel event-card" style={{ padding: '0', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                                        {event.cover_image_url && (
                                            <img
                                                src={event.cover_image_url}
                                                alt="Event Cover"
                                                style={{ width: '100%', height: '180px', objectFit: 'cover', display: 'block' }}
                                            />
                                        )}
                                        <div style={{ padding: '16px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => setSelectedEvent(event)}>
                                                    <h3 style={{ color: 'var(--color-primary)' }}>{event.title}</h3>
                                                    <p style={{ fontSize: '0.9em', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <MapPin size={16} /> {event.location}
                                                    </p>
                                                    {event.tribe_name && (
                                                        <p style={{ fontSize: '0.85em', color: 'var(--color-primary-dark)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '600' }}>
                                                            🏘️ Tribe: {event.tribe_name}
                                                        </p>
                                                    )}

                                                    {/* Event Start Date-Time */}
                                                    <p style={{ fontSize: '0.85rem', color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: '4px', margin: '4px 0 8px 0', fontWeight: 500 }}>
                                                        📅 {new Date(event.start_time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                                                    </p>
                                                    
                                                    {/* Creator details directly on the card */}
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: '8px 0 12px 0' }}>
                                                        {event.creator_avatar_url ? (
                                                            <img src={event.creator_avatar_url} alt={event.creator_name} style={{ width: '20px', height: '20px', borderRadius: '50%' }} />
                                                        ) : (
                                                            <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: 'var(--color-bg)', fontWeight: 'bold' }}>
                                                                {(event.creator_name || 'U')[0]}
                                                            </div>
                                                        )}
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                                            by <strong>{event.creator_name || 'Tribe Member'}</strong>
                                                        </span>
                                                    </div>

                                                    {/* RSVP indicators and Share Action */}
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                                        <div style={{ display: 'flex', gap: '8px', fontSize: '0.8rem' }}>
                                                            <span style={{ background: 'rgba(255,255,255,0.06)', padding: '4px 8px', borderRadius: '12px', color: 'var(--color-text-muted)' }}>
                                                                🟢 {event.going_count || 0} Going
                                                            </span>
                                                            {event.not_going_count && event.not_going_count > 0 ? (
                                                                <span style={{ background: 'rgba(255,255,255,0.06)', padding: '4px 8px', borderRadius: '12px', color: 'var(--color-text-muted)' }}>
                                                                    🔴 {event.not_going_count} Not Going
                                                                </span>
                                                            ) : null}
                                                            {event.user_rsvp && event.user_rsvp !== 'none' && (
                                                                <span style={{ background: 'rgba(var(--color-accent-rgb), 0.1)', border: '1px solid var(--color-accent)', padding: '3px 8px', borderRadius: '12px', color: 'var(--color-accent)', fontWeight: 'bold', fontSize: '0.75rem' }}>
                                                                    {event.user_rsvp === 'going' ? 'Going' : 'Not Going'}
                                                                </span>
                                                            )}
                                                        </div>
                                                        
                                                        <button 
                                                            className="icon-btn" 
                                                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--color-accent)', padding: '4px 8px' }}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const shareUrl = `${window.location.origin}?event=${event.id}`;
                                                                navigator.clipboard.writeText(shareUrl).then(() => {
                                                                    alert("Event link copied to clipboard!");
                                                                });
                                                            }}
                                                        >
                                                            <span>📤 Share</span>
                                                        </button>
                                                    </div>

                                                    <div className="ql-snow" style={{ marginTop: '4px', marginBottom: '16px' }}>
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
                                                             dangerouslySetInnerHTML={{ __html: event.description || '' }}
                                                         />
                                                     </div>
                                                </div>
                                                {!event.is_official && <span className="badge" style={{ background: 'var(--color-accent)', padding: '4px 8px', borderRadius: '12px', fontSize: '0.8rem', color: 'black' }}>Draft</span>}
                                            </div>

                                            {!event.is_official && (
                                                <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.1)' }}>
                                                    <p style={{ fontSize: '0.9rem', marginBottom: '12px', color: 'var(--color-text)' }}>
                                                        <strong>Needs Approvals</strong><br />
                                                        <span className="subtitle">2 approvals from your tribe required to make this official.</span>
                                                    </p>
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        <button
                                                            className="btn btn-secondary"
                                                            style={{ flex: 1, padding: '8px', borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}
                                                            onClick={() => onApproveEvent?.(event.id)}
                                                        >
                                                            Approve Event
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                        </div>
                    ) : (
                        <div className="empty-state">
                            <TreePine size={64} className="empty-icon" />
                            <p>No events scheduled for this tribe yet.</p>
                        </div>
                    )}
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

                                <div style={{ flexShrink: 0, display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <button
                                        className="btn btn-secondary"
                                        style={{ padding: '6px 14px', fontSize: '0.9rem' }}
                                        onClick={(e) => { e.stopPropagation(); setViewingTribeEvents(tribe); }}
                                    >
                                        📅 Events
                                    </button>

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

                        {/* Tribe Events Section */}
                        <div style={{ marginTop: '24px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '20px', marginBottom: '30px' }}>
                            <h3 style={{ color: 'var(--color-primary)', marginBottom: '16px', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                📅 Tribe Events
                            </h3>
                            
                            {events.filter(e => e.tribe_id === selectedTribe.id).length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '300px', overflowY: 'auto', paddingRight: '4px' }}>
                                    {events
                                        .filter(e => e.tribe_id === selectedTribe.id)
                                        .map(event => (
                                            <div 
                                                key={event.id} 
                                                className="glass-panel" 
                                                style={{ 
                                                    padding: '12px', 
                                                    borderRadius: 'var(--radius-sm)', 
                                                    cursor: 'pointer', 
                                                    display: 'flex', 
                                                    justifyContent: 'space-between', 
                                                    alignItems: 'center',
                                                    background: 'rgba(255,255,255,0.02)',
                                                    border: '1px solid rgba(255,255,255,0.05)',
                                                    transition: 'all 0.2s ease'
                                                }}
                                                onClick={() => setSelectedEvent(event)}
                                                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                                                onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                                            >
                                                <div style={{ minWidth: 0, flex: 1 }}>
                                                    <h4 style={{ color: 'var(--color-text)', margin: '0 0 4px 0', fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {event.title}
                                                    </h4>
                                                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-accent)' }}>
                                                        📅 {new Date(event.start_time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                                                    </p>
                                                    <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        📍 {event.location}
                                                    </p>
                                                </div>
                                                
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginLeft: '12px' }}>
                                                    {!event.is_official && (
                                                        <span className="badge" style={{ background: 'var(--color-accent)', padding: '2px 6px', borderRadius: '8px', fontSize: '0.7rem', color: 'black' }}>
                                                            Draft
                                                        </span>
                                                    )}
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                                        🟢 {event.going_count || 0}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                </div>
                            ) : (
                                <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', margin: 0 }}>
                                    No events scheduled for this tribe yet.
                                </p>
                            )}
                        </div>

                        <div style={{ display: 'flex', gap: '12px', marginTop: 'auto' }}>
                            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setSelectedTribe(null)}>Go Back</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Event Details Modal Popup */}
            {selectedEvent && (
                <div
                    className="modal-overlay"
                    onClick={(e) => { if (e.target === e.currentTarget) setSelectedEvent(null); }}
                    style={{ backdropFilter: 'blur(8px)', zIndex: 1100 }}
                >
                    <div className="modal-content glass-panel" style={{ maxWidth: '600px', width: '90%', maxHeight: '85vh', overflowY: 'auto', padding: '0', display: 'flex', flexDirection: 'column' }}>
                        {selectedEvent.cover_image_url && (
                            <img
                                src={selectedEvent.cover_image_url}
                                alt="Event Cover"
                                style={{ width: '100%', height: '240px', objectFit: 'cover', display: 'block', borderRadius: 'var(--radius-md) var(--radius-md) 0 0' }}
                            />
                        )}
                        <div style={{ padding: '24px' }}>
                            <div className="modal-header" style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div>
                                    <h2 style={{ color: 'var(--color-primary)', margin: 0 }}>{selectedEvent.title}</h2>
                                    
                                    {/* Date & Location Details */}
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '0.9em', marginTop: '8px', color: 'var(--color-text-muted)' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <MapPin size={16} /> {selectedEvent.location}
                                        </span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-accent)' }}>
                                            📅 {new Date(selectedEvent.start_time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                                        </span>
                                        {selectedEvent.tribe_name && (
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-primary-dark)', fontWeight: 'bold' }}>
                                                🏘️ Tribe: {selectedEvent.tribe_name}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <button className="icon-btn" onClick={() => setSelectedEvent(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px' }}>
                                    <span style={{ fontSize: '1.5rem', color: 'var(--color-text-muted)' }}>&times;</span>
                                </button>
                            </div>

                            {/* Creator Block */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '16px 0', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                {selectedEvent.creator_avatar_url ? (
                                    <img src={selectedEvent.creator_avatar_url} alt={selectedEvent.creator_name} style={{ width: '36px', height: '36px', borderRadius: '50%' }} />
                                ) : (
                                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.95rem', color: 'var(--color-bg)', fontWeight: 'bold' }}>
                                        {(selectedEvent.creator_name || 'U')[0]}
                                    </div>
                                )}
                                <div>
                                    <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: 0 }}>Organized by</p>
                                    <p style={{ fontSize: '0.9rem', fontWeight: 'bold', margin: 0, color: 'var(--color-text)' }}>{selectedEvent.creator_name || 'Tribe Member'}</p>
                                </div>
                            </div>

                            {/* Event Description */}
                            <div style={{ margin: '20px 0' }}>
                                <h4 style={{ color: 'var(--color-primary)', marginBottom: '8px', fontSize: '0.95rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Event Details</h4>
                                <div className="ql-snow">
                                    <div 
                                        className="ql-editor tribe-description" 
                                        style={{ 
                                            padding: 0, 
                                            color: 'var(--color-text)', 
                                            lineHeight: '1.6', 
                                            fontSize: '0.95rem',
                                            wordBreak: 'break-word',
                                            overflowWrap: 'anywhere'
                                        }} 
                                        dangerouslySetInnerHTML={{ __html: selectedEvent.description || '' }} 
                                    />
                                </div>
                            </div>

                            {/* RSVP Section */}
                            <div style={{ margin: '24px 0', padding: '16px', background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', color: 'var(--color-primary)' }}>Are you going?</h4>
                                
                                <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                                    <button 
                                        className={`btn ${selectedEvent.user_rsvp === 'going' ? 'btn-primary' : 'btn-secondary'}`}
                                        style={{ flex: 1, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'all 0.2s ease' }}
                                        onClick={async () => {
                                            if (!onRsvpEvent) return;
                                            const newRsvp = selectedEvent.user_rsvp === 'going' ? 'none' : 'going';
                                            await onRsvpEvent(selectedEvent.id, newRsvp);
                                            setSelectedEvent(prev => prev ? { 
                                                ...prev, 
                                                user_rsvp: newRsvp,
                                                going_count: newRsvp === 'going' ? (prev.going_count || 0) + 1 : (prev.going_count || 1) - 1,
                                                not_going_count: prev.user_rsvp === 'not_going' ? (prev.not_going_count || 1) - 1 : prev.not_going_count
                                            } : null);
                                        }}
                                    >
                                        <CheckCircle size={16} /> Going ({selectedEvent.going_count || 0})
                                    </button>
                                    
                                    <button 
                                        className={`btn`}
                                        style={{ 
                                            flex: 1, 
                                            padding: '10px 16px', 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            justifyContent: 'center', 
                                            gap: '8px',
                                            transition: 'all 0.2s ease',
                                            borderColor: selectedEvent.user_rsvp === 'not_going' ? '#ff4d4d' : 'rgba(255, 255, 255, 0.2)',
                                            backgroundColor: selectedEvent.user_rsvp === 'not_going' ? 'rgba(255, 77, 77, 0.2)' : 'transparent',
                                            color: selectedEvent.user_rsvp === 'not_going' ? '#ff4d4d' : 'var(--color-text)'
                                        }}
                                        onClick={async () => {
                                            if (!onRsvpEvent) return;
                                            const newRsvp = selectedEvent.user_rsvp === 'not_going' ? 'none' : 'not_going';
                                            await onRsvpEvent(selectedEvent.id, newRsvp);
                                            setSelectedEvent(prev => prev ? { 
                                                ...prev, 
                                                user_rsvp: newRsvp,
                                                not_going_count: newRsvp === 'not_going' ? (prev.not_going_count || 0) + 1 : (prev.not_going_count || 1) - 1,
                                                going_count: prev.user_rsvp === 'going' ? (prev.going_count || 1) - 1 : prev.going_count
                                            } : null);
                                        }}
                                    >
                                        <XCircle size={16} /> Not Going ({selectedEvent.not_going_count || 0})
                                    </button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setSelectedEvent(null)}>Close Details</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
