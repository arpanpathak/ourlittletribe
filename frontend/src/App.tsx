import { useState, useEffect } from 'react';
import { TreePine, Ticket } from 'lucide-react';

import Navbar from './components/layout/Navbar';
import SettingsModal from './components/layout/SettingsModal';
import HomeFeed from './pages/HomeFeed';
import TribesView from './pages/TribesView';
import ActivitiesView from './pages/ActivitiesView';

import type { User, Event, Tribe } from './types';

// API Configuration
const API_BASE = 'http://localhost:8080';

export default function App() {
  const [currentView, setCurrentView] = useState<'feed' | 'tribes' | 'activities'>('feed');
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

  const handleCreateEvent = async (title: string, desc: string, coverImage: string, location: string, tribeId: string) => {
    // Add 1 hour to current time for start_time since MVP doesn't have a date picker yet
    const startTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();

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
          start_time: startTime,
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
    // Placeholder MVP search logic
    console.log("Searching for:", query);
    alert(`MVP Feature: Searching for '${query}'`);
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
          />
        )}

        {currentView === 'tribes' && (
          <TribesView
            user={user}
            tribes={tribes}
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
          />
        )}

        {currentView === 'activities' && <ActivitiesView />}
      </main>

      {/* Searchable Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onLogout={handleLogout}
      />

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
      </div>
    </div>
  );
}
