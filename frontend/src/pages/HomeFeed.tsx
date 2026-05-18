import { LogOut, CalendarOff, MapPin } from 'lucide-react';
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
    onSelectEvent: (event: Event) => void;
}

export default function HomeFeed({
    user, events, tribes, onLogin, isDraftingEvent, setIsDraftingEvent, onCreateEvent, onApproveEvent, onSelectEvent
}: HomeFeedProps) {

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
                                                <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => onSelectEvent(event)}>
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
        </div>
    );
}
