import { Ticket } from 'lucide-react';

export default function ActivitiesView() {
    return (
        <div className="view">
            <h2>Activities</h2>
            <div className="empty-state">
                <Ticket size={64} className="empty-icon" />
                <p>No recent activity detected.</p>
            </div>
        </div>
    );
}
