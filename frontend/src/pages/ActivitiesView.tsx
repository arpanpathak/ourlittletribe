import { useEffect, useState } from 'react';
import { backendApi } from '../utils/api';

export default function ActivitiesView() {
  const [activities, setActivities] = useState<any[]>([]);

  useEffect(() => {
    fetchActivities();
  }, []);

  const fetchActivities = async () => {
    try {
      const res = await backendApi.get('/v1/activities');
      setActivities(res.data.activities || []);
    } catch (e) {
      console.error(e);
    }
  };

  const getIcon = (type: string) => {
    switch(type) {
      case 'CREATED_TRIBE': return '🏗️';
      case 'JOINED_TRIBE': return '🤝';
      case 'CREATED_EVENT': return '📅';
      default: return '✨';
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6 animate-fade-in">
      <div className="bg-slate-800/50 backdrop-blur-md rounded-2xl p-6 border border-white/10 shadow-2xl">
        <h2 className="text-2xl font-bold text-white mb-6">Recent Activity</h2>
        
        {activities.length === 0 ? (
          <p className="text-gray-400 text-center py-8 italic">No activity found. Time to start connecting!</p>
        ) : (
          <div className="space-y-4">
            {activities.map(a => (
              <div key={a.id} className="flex gap-4 items-start p-4 bg-black/20 rounded-xl border border-white/5 hover:border-emerald-500/30 transition-all">
                <div className="text-2xl">{getIcon(a.action_type)}</div>
                <div className="flex-1">
                  <p className="text-white">
                    <span className="font-semibold text-emerald-400">User {a.user_id.substring(0,6)}</span>{' '}
                    <span className="text-gray-300">
                      {a.action_type.replace('_', ' ').toLowerCase()}
                    </span>{' '}
                    <span className="font-semibold text-white">
                      {a.details?.name || a.details?.title || a.target_type}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(a.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
