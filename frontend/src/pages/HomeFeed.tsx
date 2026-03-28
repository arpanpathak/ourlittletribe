import { useState } from 'react';
import { LogOut, CalendarOff, MapPin } from 'lucide-react';
import type { User, Event, Tribe } from '../types';
import DraftEventForm from '../components/events/DraftEventForm';

interface HomeFeedProps {
    user: User | null;
    events: Event[];
    tribes: Tribe[];
    onLogin: () => void;
    isDraftingEvent: boolean;
    setIsDraftingEvent: (val: boolean) => void;
    onCreateEvent: (title: string, desc: string, coverImage: string, location: string, tribeId: string) => Promise<void>;
    onApproveEvent: (eventId: string) => Promise<void>;
}

export default function HomeFeed({
    user, events, tribes, onLogin, isDraftingEvent, setIsDraftingEvent, onCreateEvent, onApproveEvent
}: HomeFeedProps) {
    const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);

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
                                                    <p style={{ fontSize: '0.9em', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <MapPin size={16} /> {event.location}
                                                    </p>
                                                    <p className="subtitle" style={{ marginTop: '12px', marginBottom: '16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>
                                                        {event.description.replace(/<[^>]*>?/gm, '')}
                                                    </p>
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
                    <div className="modal-content glass-panel" style={{ maxWidth: '600px', width: '90%', maxHeight: '80vh', overflowY: 'auto', padding: '0' }}>
                        {selectedEvent.cover_image_url && (
                            <img
                                src={selectedEvent.cover_image_url}
                                alt="Event Cover"
                                style={{ width: '100%', height: '240px', objectFit: 'cover', display: 'block', borderRadius: 'var(--radius-md) var(--radius-md) 0 0' }}
                            />
                        )}
                        <div style={{ padding: '24px' }}>
                            <div className="modal-header" style={{ marginBottom: '20px' }}>
                                <div>
                                    <h2 style={{ color: 'var(--color-primary)' }}>{selectedEvent.title}</h2>
                                    <p style={{ fontSize: '0.9em', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-text-muted)' }}>
                                        <MapPin size={16} /> {selectedEvent.location}
                                    </p>
                                </div>
                                <button className="icon-btn" onClick={() => setSelectedEvent(null)}>
                                    <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>&times;</span>
                                </button>
                            </div>

                            {/* Render rich text natively */}
                            <div className="tribe-description" style={{ color: 'var(--color-text)', lineHeight: '1.6', marginBottom: '30px' }} dangerouslySetInnerHTML={{ __html: selectedEvent.description }} />

                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setSelectedEvent(null)}>Go Back</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
