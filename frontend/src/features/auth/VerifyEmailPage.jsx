import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthApiError, verifyEmail } from '../../lib/api';
import { tokenFromFragment } from '../../lib/auth-token';
export function VerifyEmailPage() {
    const started = useRef(false);
    const tokenRef = useRef(null);
    const [status, setStatus] = useState('checking');
    async function submitToken(token) {
        setStatus('checking');
        try {
            await verifyEmail(token);
            tokenRef.current = null;
            setStatus('verified');
        }
        catch (error) {
            setStatus(error instanceof AuthApiError && error.status === 400 ? 'invalid' : 'unavailable');
        }
    }
    useEffect(() => {
        if (started.current)
            return;
        started.current = true;
        const token = tokenFromFragment(window.location.hash);
        tokenRef.current = token;
        window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
        if (!token) {
            setStatus('invalid');
            return;
        }
        void submitToken(token);
    }, []);
    return (<main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <section className="mx-auto max-w-md space-y-5 rounded-2xl border border-slate-700 bg-slate-900 p-8">
        <h1 className="text-2xl font-bold">Verify your email</h1>
        <p role="status">
          {status === 'checking' ? 'Checking your link…' : status === 'verified'
            ? 'Your email is verified. You can now sign in.'
            : status === 'unavailable' ? 'Verification is temporarily unavailable. Please try again.'
                : 'This link is invalid or has expired. Request a new verification email.'}
        </p>
        {status === 'unavailable' && <button className="rounded bg-indigo-600 px-4 py-2" onClick={() => { if (tokenRef.current)
        void submitToken(tokenRef.current); }}>Try again</button>}
        <div className="flex flex-wrap gap-4">
          {status === 'invalid' && <Link className="text-indigo-300 underline" to="/resend-verification">Resend verification</Link>}
          <Link className="text-indigo-300 underline" to="/login">Back to sign in</Link>
        </div>
      </section>
    </main>);
}
