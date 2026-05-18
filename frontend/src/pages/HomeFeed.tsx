import { useState, useEffect } from 'react';
import { LogOut, CalendarOff, MapPin, CheckCircle, XCircle } from 'lucide-react';
import type { User, Event, Tribe } from '../types';
import DraftEventForm from '../components/events/DraftEventForm';
import 'react-quill-new/dist/quill.snow.css';

interface HomeFeedProps {
    user: User | null;
    events: Event[];
    tribes: Tribe[];
    onLogin: () => void;
    isDraftingEvent: boolean;
    setIsDraftingEvent: (val: boolean) => void;
    onCreateEvent: (title: string, desc: string, coverImage: string, location: string, tribeId: string, startTime: string) => Promise<void>;
    onApproveEvent: (eventId: string) => Promise<void>;
    onRsvpEvent: (eventId: string, status: 'going' | 'not_going' | 'none') => Promise<void>;
}

export default function HomeFeed({
    user, events, tribes, onLogin, isDraftingEvent, setIsDraftingEvent, onCreateEvent, onApproveEvent, onRsvpEvent
}: HomeFeedProps) {
    const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
    const [shareCopied, setShareCopied] = useState(false);

    // Dynamic sharing growth loop: listen for ?event=UUID in the URL and open the modal automatically
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const eventId = urlParams.get('event');
        if (eventId) {
            const found = events.find(e => e.id === eventId);
            if (found) {
                setSelectedEvent(found);
            } else if (user) {
                // Fetch directly from the backend if it's not in their local feed list
                fetch(`/v1/events/${eventId}`, { credentials: 'include' })
                    .then(res => {
                        if (res.ok) return res.json();
                        throw new Error('Shared event not found');
                    })
                    .then(data => {
                        setSelectedEvent(data);
                    })
                    .catch(err => {
                        console.error("Failed fetching shared event:", err);
                    });
            }
        }
    }, [events, user]);

    return (
        <div className="view">
            <div className="hero-section text-center">
                {!user && (
                    <>
                        <svg className="pnw-mascot" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="50" cy="50" r="45" fill="var(--color-primary-dark)" opacity="0.3" />
                            <path d="M50 15 C70 15, 80 40, 80 70 L20 70 C20 40, 30 15, 50 15 Z" fill="var(--color-accent)" />
                            <circle cx="35" cy="40" r="4" fill="var(--color-bg)" />
                            <circle cx="65" cy="40" r="4" fill="var(--color-bg)" />
                            <path d="M45 55 Q50 65, 55 55" stroke="var(--color-bg)" strokeWidth="3" fill="none" strokeLinecap="round" />
                        </svg>
                        <h2>Discover Local Events.</h2>
                        <p className="subtitle">Join tribes and build community without the corporate fees.</p>
                        <button className="btn btn-primary mt-4" onClick={onLogin}>
                            <LogOut className="mr-2" size={20} style={{ transform: 'rotate(180deg)' }} /> Continue with Google
                        </button>
                    </>
                )}

                {user && (
                    <div style={{ width: '100%', padding: '20px 0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <h2>Welcome, {user.name.split(' ')[0]}</h2>
                            <button className="btn btn-primary" style={{ padding: '8px 16px' }} onClick={() => setIsDraftingEvent(!isDraftingEvent)}>
                                {isDraftingEvent ? 'Cancel' : <><CalendarOff size={16} className="mr-2" /> Draft Event</>}
                            </button>
                        </div>
                        <p className="subtitle" style={{ textAlign: 'left' }}>Check out upcoming official events.</p>

                        {isDraftingEvent && (
                            <DraftEventForm
                                tribes={tribes}
                                onSubmit={onCreateEvent}
                                onCancel={() => setIsDraftingEvent(false)}
                            />
                        )}

                        {!isDraftingEvent && (
                            <div className="events-feed mt-4" style={{ textAlign: 'left', marginTop: '30px' }}>
                                {events.length > 0 ? events.map(event => (
                                    <div key={event.id} className="glass-panel event-card mt-2" style={{ padding: '0', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
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
                                                            onClick={() => onApproveEvent(event.id)}
                                                        >
                                                            Approve Event
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )) : (
                                    <div className="empty-state">
                                        <CalendarOff size={64} className="empty-icon" />
                                        <p>No official events found in your radius.</p>
                                        <button className="btn btn-primary mt-4" onClick={() => setIsDraftingEvent(true)}>Draft an Event</button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Event Details Modal Popup */}
            {selectedEvent && (
                <div
                    className="modal-overlay"
                    onClick={(e) => { if (e.target === e.currentTarget) setSelectedEvent(null); }}
                    style={{ backdropFilter: 'blur(8px)', zIndex: 1000 }}
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

                                {selectedEvent.user_rsvp && selectedEvent.user_rsvp !== 'none' && (
                                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-accent)', textAlign: 'center', opacity: 0.9 }}>
                                        Marked as <strong>{selectedEvent.user_rsvp === 'going' ? 'Going' : 'Not Going'}</strong>. Click again to remove your RSVP.
                                    </p>
                                )}
                            </div>

                            <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setSelectedEvent(null)}>Go Back</button>
                                <button 
                                    className="btn btn-primary" 
                                    style={{ flex: 1, backgroundColor: 'var(--color-accent)', color: 'black', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                                    onClick={() => {
                                        const shareUrl = `${window.location.origin}?event=${selectedEvent.id}`;
                                        navigator.clipboard.writeText(shareUrl).then(() => {
                                            setShareCopied(true);
                                            setTimeout(() => setShareCopied(false), 2000);
                                        });
                                    }}
                                >
                                    {shareCopied ? '🔗 Link Copied!' : '📤 Share Event'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
