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
        cache: 'no-store',
    });
    if (!response.ok)
        throw new AuthApiError(response.status);
    return response;
}
export async function login(email, password) {
    const response = await postAuth('login', { email, password })
    const { access_token: accessToken } = await response.json()
    if (typeof accessToken !== 'string' || !accessToken) throw new Error('Invalid sign-in response')
    return { accessToken }
}
export function register(email, password) {
    return postAuth('register', { email, password })
}
export function forgotPassword(email) {
    return postAuth('password/forgot', { email })
}
export function requestVerification(email) {
    return postAuth('verification/request', { email })
}
export function verifyEmail(token) {
    return postAuth('verify', { token });
}
export function resetPassword(token, newPassword) {
    return postAuth('password/reset', { token, new_password: newPassword });
}
