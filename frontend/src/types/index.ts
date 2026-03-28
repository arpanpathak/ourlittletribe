export interface User {
    id: string;
    name: string;
    email: string;
    avatar_url: string;
}

export interface Event {
    id: string;
    tribe_id: string;
    creator_id: string;
    title: string;
    description: string;
    cover_image_url?: string;
    location: string;
    is_official: boolean;
    start_time: string;
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
