const API_BASE = '/api';

export const api = {
  // --- Auth ---
  login: async (username: string, password: string): Promise<{ success: boolean; username: string }> => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || 'Invalid username or password');
    }
    return res.json();
  },
};
