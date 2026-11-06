import { APP_CONFIG } from '../config'
const baseUrl = APP_CONFIG.apiUrl;
export class AuthApiError extends Error {
    status;
    constructor(status) {
        super(`Authentication request failed (${status})`);
        this.status = status;
    }
}
export async function getHealth() {
    const response = await fetch(`${baseUrl}/health`);
    if (!response.ok)
        throw new Error('API health check failed');
    return (await response.json());
}
async function postAuth(path, payload) {
    const response = await fetch(`${baseUrl}/api/v1/auth/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response.ok)
        throw new AuthApiError(response.status);
}
export function verifyEmail(token) {
    return postAuth('verify', { token });
}
export function resetPassword(token, newPassword) {
    return postAuth('password/reset', { token, new_password: newPassword });
}
