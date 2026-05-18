export interface User {
    id: string;
    name: string;
    email: string;
    avatar_url: string;
}

export interface Event {
    id: string;
    tribe_id: string;
    tribe_name?: string;
    creator_id: string;
    creator_name?: string;
    creator_avatar_url?: string;
    title: string;
    description: string;
    cover_image_url?: string;
    location: string;
    is_official: boolean;
    start_time: string;

    // Vote details
    net_votes?: number;
    user_vote?: number;

    // RSVP details
    going_count?: number;
    not_going_count?: number;
    user_rsvp?: 'going' | 'not_going' | 'none';
}

export interface Tribe {
    id: string;
    name: string;
    description: string;
    creator_id?: string;
    created_at?: string;
    is_member?: boolean;
    member_count?: number;
    members?: {
        id: string;
        name: string;
        avatar_url: string;
    }[];
}
