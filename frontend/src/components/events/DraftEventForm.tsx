import { useState } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import type { Tribe } from '../../types';

interface DraftEventFormProps {
    tribes: Tribe[];
    onSubmit: (title: string, desc: string, coverImageUrl: string, location: string, tribeId: string) => Promise<void>;
    onCancel: () => void;
}

export default function DraftEventForm({ tribes, onSubmit, onCancel }: DraftEventFormProps) {
    const [title, setTitle] = useState('');
    const [location, setLocation] = useState('');
    const [description, setDescription] = useState('');
    const [coverImage, setCoverImage] = useState(''); // New state for cover image
    const [selectedTribeId, setSelectedTribeId] = useState('');

    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title || !description || !location || !selectedTribeId) return;

        setIsSubmitting(true);
        await onSubmit(title, description, coverImage, location, selectedTribeId); // Updated onSubmit call
        setIsSubmitting(false);
    };

    return (
        <form onSubmit={handleSubmit} className="glass-panel mt-4" style={{ padding: '20px', borderRadius: 'var(--radius-md)', textAlign: 'left', maxWidth: '600px', margin: '0 auto' }}>
            <h3 style={{ marginBottom: '16px', color: 'var(--color-primary)' }}>Draft a New Event</h3>

            <div className="form-group mb-3">
                <label className="subtitle" style={{ display: 'block', marginBottom: '4px' }}>Which Tribe?</label>
                <div className="search-container" style={{ background: 'rgba(0,0,0,0.2)' }}>
                    <select
                        value={selectedTribeId}
                        onChange={e => setSelectedTribeId(e.target.value)}
                        required
                        style={{ width: '100%', background: 'transparent', border: 'none', color: 'var(--color-text)', padding: '8px', outline: 'none' }}
                    >
                        <option value="" disabled>Select a tribe...</option>
                        {tribes.map(t => (
                            <option key={t.id} value={t.id} style={{ color: 'black' }}>{t.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="form-group mb-3">
                <label className="subtitle" style={{ display: 'block', marginBottom: '4px' }}>Event Title</label>
                <div className="search-container" style={{ background: 'rgba(0,0,0,0.2)' }}>
                    <input
                        type="text"
                        placeholder="e.g. Saturday Morning Hike"
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        required
                    />
                </div>
            </div>

            <div className="form-group mb-3">
                <label className="subtitle" style={{ display: 'block', marginBottom: '4px' }}>Cover Image URL (optional)</label>
                <div className="search-container" style={{ background: 'rgba(0,0,0,0.2)' }}>
                    <input
                        type="url"
                        placeholder="e.g. https://images.unsplash.com/photo-123..."
                        value={coverImage}
                        onChange={e => setCoverImage(e.target.value)}
                    />
                </div>
            </div>

            <div className="form-group mb-3">
                <label className="subtitle" style={{ display: 'block', marginBottom: '4px' }}>General Location</label>
                <div className="search-container" style={{ background: 'rgba(0,0,0,0.2)' }}>
                    <input
                        type="text"
                        placeholder="e.g. Mount Si Trailhead"
                        value={location}
                        onChange={e => setLocation(e.target.value)}
                        required
                    />
                </div>
            </div>

            <div className="form-group mb-4">
                <label className="subtitle" style={{ display: 'block', marginBottom: '4px' }}>What are we doing?</label>
                {/* Using react-quill for rich text, overriding the snow theme with our CSS variables implicitly */}
                <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                    <ReactQuill
                        theme="snow"
                        value={description}
                        onChange={setDescription}
                        style={{ height: '200px', color: 'var(--color-text)' }}
                    />
                </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '50px' }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={onCancel} disabled={isSubmitting}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={isSubmitting}>
                    {isSubmitting ? 'Proposing...' : 'Propose Event'}
                </button>
            </div>
        </form>
    );
}
