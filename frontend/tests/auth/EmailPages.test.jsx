// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
let container;
let root;
let requests;
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    requests = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', requests);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});
async function openPage(path, fragment = '#token=test-link-token') {
    window.history.replaceState(null, '', path + fragment);
    await act(async () => root.render(<StrictMode><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></StrictMode>));
}
async function enterPasswords(password, confirmation = password) {
    const inputs = container.querySelectorAll('input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    await act(async () => {
        for (const [index, value] of [password, confirmation].entries()) {
            setter.call(inputs[index], value);
            inputs[index].dispatchEvent(new Event('input', { bubbles: true }));
        }
    });
}
async function submit() {
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}
describe('email verification', () => {
    it('consumes the link once in StrictMode and clears it from browser history', async () => {
        await openPage('/verify-email');
        expect(container.textContent).toContain('Your email is verified');
        expect(window.location.hash).toBe('');
        expect(requests).toHaveBeenCalledTimes(1);
        expect(JSON.parse(requests.mock.calls[0][1].body)).toEqual({ token: 'test-link-token' });
    });
    it('rejects a missing token without sending a request', async () => {
        await openPage('/verify-email', '');
        expect(container.textContent).toContain('invalid or has expired');
        expect(requests).not.toHaveBeenCalled();
    });
    it('offers a new verification email instead of retrying a consumed or expired link', async () => {
        requests.mockResolvedValue(new Response(null, { status: 400 }));
        await openPage('/verify-email');
        expect(container.textContent).toContain('invalid or has expired');
        expect(container.querySelector('button')).toBeNull();
        expect(container.querySelector('a[href="/resend-verification"]')).not.toBeNull();
    });
    it('confirms verification and offers a link to sign in', async () => {
        await openPage('/verify-email');
        expect(container.textContent).toContain('Your email is verified.');
        expect(container.querySelector('a[href="/login"]')).not.toBeNull();
    });
    it('retains the token for retry after temporary downtime', async () => {
        requests.mockResolvedValueOnce(new Response(null, { status: 503 }));
        await openPage('/verify-email');
        expect(container.textContent).toContain('temporarily unavailable');
        await act(async () => container.querySelector('button').click());
        expect(container.textContent).toContain('Your email is verified');
        expect(requests).toHaveBeenCalledTimes(2);
        expect(JSON.parse(requests.mock.calls[1][1].body)).toEqual({ token: 'test-link-token' });
    });
});
describe('password reset', () => {
    it('rejects a missing token without offering a password form', async () => {
        await openPage('/reset-password', '');
        expect(container.textContent).toContain('invalid or has expired');
        expect(container.querySelector('form')).toBeNull();
        expect(requests).not.toHaveBeenCalled();
    });
    it('rejects mismatched passwords without using the link', async () => {
        await openPage('/reset-password');
        await enterPasswords('new-test-password', 'another-password');
        await submit();
        expect(container.textContent).toContain('Passwords do not match');
        expect(requests).not.toHaveBeenCalled();
    });
    it('submits a matching password and clears the form after success', async () => {
        await openPage('/reset-password');
        expect(window.location.hash).toBe('');
        await enterPasswords('new-test-password');
        await submit();
        expect(container.textContent).toContain('Password changed');
        expect(container.querySelector('input')).toBeNull();
        expect(requests).toHaveBeenCalledTimes(1);
        expect(JSON.parse(requests.mock.calls[0][1].body)).toEqual({
            token: 'test-link-token', new_password: 'new-test-password',
        });
    });
    it('allows retry on downtime but blocks submission for an expired link', async () => {
        requests.mockResolvedValueOnce(new Response(null, { status: 503 }));
        requests.mockResolvedValueOnce(new Response(null, { status: 400 }));
        await openPage('/reset-password');
        await enterPasswords('new-test-password');
        await submit();
        expect(container.textContent).toContain('temporarily unavailable');
        expect(container.querySelector('button').disabled).toBe(false);
        await submit();
        expect(container.textContent).toContain('invalid or has expired');
        expect(container.querySelector('button').disabled).toBe(true);
    });
});
