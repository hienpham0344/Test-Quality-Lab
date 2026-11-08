# Authentication

- `/login` signs in through `POST /api/v1/auth/login`.
- `/signup` creates an account and prompts for email verification.
- `/verify-email` consumes the one-time email link; `/resend-verification` requests a replacement.
- `/forgot-password` requests a reset link and shows the same confirmation for every eligible email format.
- `/reset-password` consumes the fragment token and submits the new password.

Verification and reset clear the token from browser history before making a request.
The sign-in access token lives in React state for the current page lifetime.
The app does not persist or log it. Reloading requires signing in again.
For a live smoke test, start the API, worker and Mailpit, register a test address,
then open the verification/reset links from Mailpit. Automated frontend tests
mock the API and can run without the backend.
