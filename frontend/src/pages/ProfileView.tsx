import { useEffect, useState } from 'react';
import { backendApi } from '../utils/api';
import { Mail, Calendar, ShieldCheck, User } from 'lucide-react';

export const ProfileView: React.FC = () => {
  const [profile, setProfile] = useState<any>(null);
  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'tribes' | 'events'>('tribes');

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await backendApi.get('/v1/profile');
      setProfile(res.data);
      setBio(res.data.bio || '');
      setLocation(res.data.location || '');
    } catch (e) {
      console.error(e);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await backendApi.patch('/v1/profile', { bio, location });
      alert('Profile updated successfully!');
    } catch (e) {
      alert('Failed to update profile');
    }
    setSaving(false);
  };

  if (!profile) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
      <div style={{ color: 'var(--color-primary)', fontWeight: 'bold' }}>Loading profile...</div>
    </div>
  );

  const inputStyle = {
    width: '100%',
    background: 'rgba(0, 0, 0, 0.25)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 'var(--radius-md)',
    padding: '12px 14px',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-main)',
    fontSize: '1rem',
    outline: 'none',
    boxSizing: 'border-box' as const,
    marginTop: '6px',
    transition: 'border-color var(--transition-fast)',
  };

  const labelStyle = {
    fontSize: '0.75rem',
    fontWeight: 'bold',
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  };

  return (
    <div className="view" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* Profile Header Card */}
      <div className="glass-panel" style={{ padding: '20px', borderRadius: 'var(--radius-md)', display: 'flex', gap: '16px', alignItems: 'center' }}>
        <img 
          src={profile.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.name)}&background=random`} 
          alt={profile.name} 
          style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--color-primary)' }} 
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <h2 style={{ margin: 0, fontSize: '1.5rem' }}>{profile.name}</h2>
            <ShieldCheck size={18} style={{ color: 'var(--color-primary)' }} />
          </div>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Mail size={14} /> {profile.email}
          </p>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Calendar size={14} /> Member since {new Date(profile.created_at).getFullYear()}
          </p>
        </div>
      </div>

      {/* Edit Public Details Card */}
      <div className="glass-panel" style={{ padding: '20px', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-primary)' }}>
          <User size={20} /> Public Details
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Location */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={labelStyle}>Location</label>
            <div style={{ position: 'relative', width: '100%' }}>
              <input 
                type="text"
                value={location}
                onChange={e => setLocation(e.target.value)}
                style={inputStyle}
                placeholder="Where are you based?"
              />
            </div>
          </div>

          {/* Bio */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={labelStyle}>About Me</label>
            <textarea 
              value={bio}
              onChange={e => setBio(e.target.value)}
              style={{ ...inputStyle, minHeight: '100px', resize: 'none' }}
              rows={4}
              placeholder="Share a bit about yourself with the community..."
            />
          </div>

          <button 
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '10px', padding: '12px' }}
          >
            {saving ? 'Saving...' : 'Update Profile'}
          </button>
        </div>
      </div>

      {/* Decluttered Tabs for Tribes & Events */}
      <div className="glass-panel" style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', background: 'rgba(0,0,0,0.15)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <button 
            style={{ 
              flex: 1, 
              background: activeTab === 'tribes' ? 'rgba(255,255,255,0.05)' : 'transparent',
              border: 'none',
              color: activeTab === 'tribes' ? 'var(--color-primary)' : 'var(--color-text-muted)',
              padding: '14px 10px',
              fontFamily: 'var(--font-main)',
              fontWeight: 'bold',
              cursor: 'pointer',
              borderBottom: activeTab === 'tribes' ? '2px solid var(--color-primary)' : 'none',
            }}
            onClick={() => setActiveTab('tribes')}
          >
            🏘️ My Tribes ({profile.tribes?.length || 0})
          </button>
          <button 
            style={{ 
              flex: 1, 
              background: activeTab === 'events' ? 'rgba(255,255,255,0.05)' : 'transparent',
              border: 'none',
              color: activeTab === 'events' ? 'var(--color-accent)' : 'var(--color-text-muted)',
              padding: '14px 10px',
              fontFamily: 'var(--font-main)',
              fontWeight: 'bold',
              cursor: 'pointer',
              borderBottom: activeTab === 'events' ? '2px solid var(--color-accent)' : 'none',
            }}
            onClick={() => setActiveTab('events')}
          >
            📅 RSVPed Events ({profile.events?.length || 0})
          </button>
        </div>

        <div style={{ padding: '20px' }}>
          {activeTab === 'tribes' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {profile.tribes?.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '20px 0', fontSize: '0.9rem' }}>
                  You haven't joined any communities yet.
                </div>
              ) : (
                profile.tribes.map((t: any) => (
                  <div key={t.id} style={{ display: 'flex', flexDirection: 'column', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <h4 style={{ margin: '0 0 4px 0', color: 'var(--color-text)' }}>{t.name}</h4>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{t.description}</p>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'events' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {profile.events?.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '20px 0', fontSize: '0.9rem' }}>
                  No upcoming events on your calendar.
                </div>
              ) : (
                profile.events.map((e: any) => (
                  <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <div>
                      <h4 style={{ margin: '0 0 4px 0', color: 'var(--color-accent)' }}>{e.title}</h4>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                        📍 {e.location} • 📅 {new Date(e.start_time).toLocaleDateString()}
                      </p>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-primary)', background: 'rgba(0, 212, 138, 0.1)', padding: '4px 8px', borderRadius: '12px', fontWeight: 'bold' }}>
                      Going
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

