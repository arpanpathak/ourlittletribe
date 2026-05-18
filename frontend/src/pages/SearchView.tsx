import { useEffect, useState } from 'react';
import { backendApi } from '../utils/api';
import { Search, MapPin } from 'lucide-react';

export default function SearchView({ 
  query, 
  onSelectTribe, 
  onSelectEvent 
}: { 
  query: string; 
  onSelectTribe: (tribe: any) => void;
  onSelectEvent: (event: any) => void;
}) {
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query) {
      handleSearch();
    }
  }, [query]);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const res = await backendApi.get(`/v1/search?q=${encodeURIComponent(query)}`);
      setResults(res.data);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  if (!query) return null;

  const hasTribes = results?.tribes?.length > 0;
  const hasEvents = results?.events?.length > 0;
  const hasUsers = results?.users?.length > 0;
  const noResults = !hasTribes && !hasEvents && !hasUsers;

  return (
    <div className="view" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
        <Search style={{ color: 'var(--color-primary)' }} size={24} />
        <h2 style={{ margin: 0 }}>Search Results</h2>
      </div>
      <p className="subtitle" style={{ marginTop: '-10px' }}>
        Showing matches for <strong>"{query}"</strong>
      </p>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-text-muted)' }}>
          Searching the tribe network...
        </div>
      ) : noResults ? (
        <div className="glass-panel text-center" style={{ padding: '40px 20px', borderRadius: 'var(--radius-md)' }}>
          <Search size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
          <p style={{ color: 'var(--color-text-muted)' }}>No matches found inside the forest.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
          {/* Tribes */}
          {hasTribes && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <h3 style={{ color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' }}>
                🏘️ Tribes ({results.tribes.length})
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {results.tribes.map((t: any) => (
                  <div 
                    key={t.id} 
                    className="glass-panel" 
                    style={{ padding: '16px', borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'background 0.2s' }}
                    onClick={() => onSelectTribe(t)}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                  >
                    <h4 style={{ color: 'var(--color-text)', margin: '0 0 6px 0', fontWeight: 'bold' }}>{t.name}</h4>
                    <div className="ql-snow">
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
                          lineHeight: '1.4',
                          color: 'var(--color-text-muted)'
                        }}
                        dangerouslySetInnerHTML={{ __html: t.description || '' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Events */}
          {hasEvents && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <h3 style={{ color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' }}>
                📅 Events ({results.events.length})
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {results.events.map((e: any) => (
                  <div 
                    key={e.id} 
                    className="glass-panel" 
                    style={{ padding: '16px', borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'background 0.2s' }}
                    onClick={() => onSelectEvent(e)}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                  >
                    <h4 style={{ color: 'var(--color-primary)', margin: '0 0 6px 0', fontWeight: 'bold' }}>{e.title}</h4>
                    <div className="ql-snow" style={{ marginBottom: '8px' }}>
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
                          lineHeight: '1.4',
                          color: 'var(--color-text-muted)'
                        }}
                        dangerouslySetInnerHTML={{ __html: e.description || '' }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', color: 'var(--color-accent)', fontWeight: 500 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <MapPin size={14} /> {e.location}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        📅 {new Date(e.start_time).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Users */}
          {hasUsers && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <h3 style={{ color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' }}>
                👤 Members ({results.users.length})
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {results.users.map((u: any) => (
                  <div key={u.id} className="glass-panel" style={{ padding: '12px', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <img 
                      src={u.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=random`} 
                      style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }} 
                      alt="" 
                    />
                    <div>
                      <h4 style={{ color: 'var(--color-text)', margin: 0, fontSize: '0.95rem', fontWeight: 'bold' }}>{u.name}</h4>
                      <div className="ql-snow">
                        <div 
                          className="ql-editor subtitle" 
                          style={{ 
                            padding: 0,
                            fontSize: '0.8rem',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            whiteSpace: 'normal',
                            maxWidth: '100%',
                            wordBreak: 'break-word',
                            overflowWrap: 'anywhere',
                            lineHeight: '1.4',
                            color: 'var(--color-text-muted)'
                          }}
                          dangerouslySetInnerHTML={{ __html: u.bio || 'New member' }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


