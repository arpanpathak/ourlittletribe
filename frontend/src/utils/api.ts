export const backendApi = {
  get: async (url: string) => {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('API Error');
    return { data: await res.json() };
  },
  post: async (url: string, data?: any) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: data ? JSON.stringify(data) : undefined,
    });
    if (!res.ok) throw new Error('API Error');
    return { data: await res.json().catch(() => ({})) };
  },
  patch: async (url: string, data?: any) => {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: data ? JSON.stringify(data) : undefined,
    });
    if (!res.ok) throw new Error('API Error');
    return { data: await res.json().catch(() => ({})) };
  }
};
