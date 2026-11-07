import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { resetPassword } from '../../services/api';
import { AuthLayout } from './components/AuthLayout';
import { tokenFromFragment } from './token';
export function ResetPasswordPage() {
    const started = useRef(false);
    const [token, setToken] = useState(undefined);
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [status, setStatus] = useState('idle');
    useEffect(() => {
        if (started.current)
            return;
        started.current = true;
        setToken(tokenFromFragment(window.location.hash));
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }, []);
    async function submit(event) {
        event.preventDefault();
        if (!token || password !== confirmation || password.length < 12)
            return;
        setStatus('saving');
        try {
            await resetPassword(token, password);
            setPassword('');
            setConfirmation('');
            setStatus('done');
        }
        catch (error) {
            setStatus(error.status === 400 ? 'invalid' : 'error');
        }
    }
    return (<AuthLayout title="Reset your password">
        {token === undefined ? <p role="status">Checking your link…</p> : !token
            ? <p role="alert">This link is invalid or has expired.</p> : status === 'done'
            ? <p role="status">Password changed. You can now sign in.</p>
            : <form className="space-y-4" onSubmit={(event) => { void submit(event); }}>
              <label className="block">New password
                <input className="mt-1 w-full rounded border border-slate-600 bg-slate-800 p-2" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required value={password} onChange={(event) => setPassword(event.target.value)}/>
              </label>
              <label className="block">Confirm password
                <input className="mt-1 w-full rounded border border-slate-600 bg-slate-800 p-2" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)}/>
              </label>
              {password && confirmation && password !== confirmation && <p role="alert">Passwords do not match.</p>}
              {status === 'invalid' && <p role="alert">This link is invalid or has expired. Request a new reset email.</p>}
              {status === 'error' && <p role="alert">Password reset is temporarily unavailable. Please try again.</p>}
              <button className="rounded bg-indigo-600 px-4 py-2 disabled:opacity-50" type="submit" disabled={status === 'saving' || status === 'invalid' || password !== confirmation}>Save password</button>
            </form>}
        <Link className="text-indigo-300 underline" to="/login">Go to sign in</Link>
    </AuthLayout>);
}
