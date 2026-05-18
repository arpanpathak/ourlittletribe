import { useState, useEffect } from 'react';
import { TreePine, Ticket, PersonStanding, MapPin, CheckCircle, XCircle, Users } from 'lucide-react';

import Navbar from './components/layout/Navbar';
import SettingsModal from './components/layout/SettingsModal';
import HomeFeed from './pages/HomeFeed';
import TribesView from './pages/TribesView';
import ActivitiesView from './pages/ActivitiesView';
import { ProfileView } from './pages/ProfileView';
import SearchView from './pages/SearchView';

import type { User, Event, Tribe } from './types';

// API Configuration
const API_BASE = '';

export default function App() {
  const [currentView, setCurrentView] = useState<'feed' | 'tribes' | 'activities' | 'profile' | 'search'>('feed');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Auth State
  const [user, setUser] = useState<User | null>(null);

  // Data State
  const [events, setEvents] = useState<Event[]>([]);
  const [tribes, setTribes] = useState<Tribe[]>([]);

  // Tribes UI State
  const [isCreatingTribe, setIsCreatingTribe] = useState(false);
  const [newTribeName, setNewTribeName] = useState('');
  const [newTribeDesc, setNewTribeDesc] = useState('');

  // Event Draft State
  const [isDraftingEvent, setIsDraftingEvent] = useState(false);

  // Routing Modals State
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedTribe, setSelectedTribe] = useState<Tribe | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  // Dynamic deep linking / sharing growth loop: listen for ?event=UUID or ?tribe=UUID in the URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const eventId = urlParams.get('event');
    const tribeId = urlParams.get('tribe');
    
    if (eventId) {
      const found = events.find(e => e.id === eventId);
      if (found) {
        setSelectedEvent(found);
      } else if (user) {
        fetch(`${API_BASE}/v1/events/${eventId}`, { credentials: 'include' })
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

    if (tribeId) {
      const found = tribes.find(t => t.id === tribeId);
      if (found) {
        setSelectedTribe(found);
      } else if (user) {
        fetch(`${API_BASE}/v1/tribes/${tribeId}`, { credentials: 'include' })
          .then(res => {
            if (res.ok) return res.json();
            throw new Error('Shared tribe not found');
          })
          .then(data => {
            setSelectedTribe(data);
          })
          .catch(err => {
            console.error("Failed fetching shared tribe:", err);
          });
      }
    }
  }, [events, tribes, user]);

  // Check auth and fetch initial feed data
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/users/me`, { credentials: 'include' });
        if (res.ok) {
          const userData = await res.json();
          setUser(userData);
          fetchEvents();
          fetchTribes();
        }
      } catch (err) {
        console.error("Not authenticated", err);
      }
    };
    checkAuth();
  }, []);

  const fetchEvents = async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/events`, { credentials: 'include' });
      const data = await res.json();
      setEvents(data.events || []);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchTribes = async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/tribes`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setTribes(data.tribes || []);
      }
    } catch (err) {
      console.error("Failed fetching tribes", err);
    }
  };

  const handleCreateTribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTribeName || !newTribeDesc) return;
    try {
      const res = await fetch(`${API_BASE}/v1/tribes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newTribeName, description: newTribeDesc })
      });
      if (res.ok) {
        setIsCreatingTribe(false);
        setNewTribeName('');
        setNewTribeDesc('');
        fetchTribes(); // refresh list
      }
    } catch (err) {
      console.error("Failed creating tribe", err);
    }
  };

  const handleJoinTribe = async (tribeId: string) => {
    try {
      const res = await fetch(`${API_BASE}/v1/tribes/${tribeId}:join`, {
        method: 'POST',
        credentials: 'include'
      });
      if (res.ok) {
        alert("Successfully joined tribe!");
        fetchTribes(); // Refresh list to update is_member
      }
    } catch (err) {
      console.error("Failed to join tribe", err);
    }
  };

  const handleLeaveTribe = async (tribeId: string) => {
    try {
      const res = await fetch(`${API_BASE}/v1/tribes/${tribeId}:leave`, {
        method: 'POST',
        credentials: 'include'
      });
      if (res.ok) {
        fetchTribes(); // Refresh list to update is_member
      }
    } catch (err) {
      console.error("Failed to leave tribe", err);
    }
  };

  const handleCreateEvent = async (title: string, desc: string, coverImage: string, location: string, tribeId: string, startTime: string) => {
    const isoStartTime = new Date(startTime).toISOString();

    try {
      const res = await fetch(`${API_BASE}/v1/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: title,
          description: desc,
          cover_image_url: coverImage,
          location: location,
          tribe_id: tribeId,
          start_time: isoStartTime,
          lat: 47.6062, // Defaulting MVP coords to Seattle
          lng: -122.3321
        })
      });

      if (res.ok) {
        setIsDraftingEvent(false);
        fetchEvents(); // refresh list
        alert("Event Drafted! Notifying tribe members for quorum voting.");
      } else {
        alert("Failed to draft event. Did you select a Tribe?");
      }
    } catch (err) {
      console.error("Failed drafting event", err);
      alert("Failed to draft event.");
    }
  };

  const handleApproveEvent = async (eventId: string) => {
    try {
      const res = await fetch(`${API_BASE}/v1/events/${eventId}:vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ vote: 1 })
      });
      if (res.ok) {
        fetchEvents(); // Refresh feed to see if it became official
      }
    } catch (err) {
      console.error("Failed to approve event", err);
    }
  };

  const handleRsvpEvent = async (eventId: string, status: 'going' | 'not_going' | 'none') => {
    try {
      const res = await fetch(`${API_BASE}/v1/events/${eventId}:rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        fetchEvents(); // Refresh feed to update RSVP details
      }
    } catch (err) {
      console.error("Failed to RSVP", err);
    }
  };

  const handleLogin = () => {
    window.location.href = `${API_BASE}/v1/auth/google/login`;
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE}/v1/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch (err) { }
    window.location.reload();
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setCurrentView('search');
  };

  return (
    <div className="app-container">
      {/* Top Navbar */}
      <Navbar onOpenSettings={() => setIsSettingsOpen(true)} onSearch={handleSearch} />

      {/* Main Content Area */}
      <main className="content-area">
        {currentView === 'feed' && (
          <HomeFeed
            user={user}
            events={events}
            tribes={tribes}
            onLogin={handleLogin}
            isDraftingEvent={isDraftingEvent}
            setIsDraftingEvent={setIsDraftingEvent}
            onCreateEvent={handleCreateEvent}
            onApproveEvent={handleApproveEvent}
            onRsvpEvent={handleRsvpEvent}
            onSelectEvent={setSelectedEvent}
          />
        )}

        {currentView === 'tribes' && (
          <TribesView
            user={user}
            tribes={tribes}
            events={events}
            isCreatingTribe={isCreatingTribe}
            setIsCreatingTribe={setIsCreatingTribe}
            newTribeName={newTribeName}
            setNewTribeName={setNewTribeName}
            newTribeDesc={newTribeDesc}
            setNewTribeDesc={setNewTribeDesc}
            onCreateTribe={handleCreateTribe}
            onJoinTribe={handleJoinTribe}
            onLeaveTribe={handleLeaveTribe}
            onLogin={handleLogin}
            onApproveEvent={handleApproveEvent}
            onRsvpEvent={handleRsvpEvent}
            onSelectTribe={setSelectedTribe}
            onSelectEvent={setSelectedEvent}
          />
        )}

        {currentView === 'activities' && <ActivitiesView />}
        {currentView === 'profile' && <ProfileView />}
        {currentView === 'search' && (
          <SearchView 
            query={searchQuery} 
            onSelectTribe={(t) => {
              setSelectedTribe(t);
              setCurrentView('tribes');
            }} 
            onSelectEvent={(e) => {
              setSelectedEvent(e);
              setCurrentView('feed');
            }} 
          />
        )}
      </main>

      {/* Searchable Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onLogout={handleLogout}
        onNavigate={(view) => {
          // If the view maps to an existing component, navigate. (We only have profile built currently)
          if (view === 'profile') setCurrentView('profile');
          else alert(`MVP: ${view} view coming soon!`);
        }}
      />

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
                      const newRsvp = selectedEvent.user_rsvp === 'going' ? 'none' : 'going';
                      await handleRsvpEvent(selectedEvent.id, newRsvp);
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
                      await handleRsvpEvent(selectedEvent.id, newRsvp);
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
                        onClick={() => {
                          setSelectedTribe(null);
                          setSelectedEvent(event);
                        }}
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

      {/* Bottom Navbar (Mobile styling) */}
      <div className="bottom-nav glass-panel">
        <button className={`nav-item ${currentView === 'feed' ? 'active' : ''}`} onClick={() => setCurrentView('feed')}>
          <TreePine size={24} />
          <span>Feed</span>
        </button>
        <button className={`nav-item ${currentView === 'tribes' ? 'active' : ''}`} onClick={() => setCurrentView('tribes')}>
          <TreePine size={24} />
          <span>Tribes</span>
        </button>
        <button className={`nav-item ${currentView === 'activities' ? 'active' : ''}`} onClick={() => setCurrentView('activities')}>
          <Ticket size={24} />
          <span>Activities</span>
        </button>
        <button className={`nav-item ${currentView === 'profile' ? 'active' : ''}`} onClick={() => setCurrentView('profile')}>
          <PersonStanding size={24} />
          <span>Profile</span>
        </button>
      </div>
    </div>
  );
}
