# auth

UC-01 (register + email verification), UC-02 (sign in / sign out) and UC-12 (password reset).

- `AuthProvider` / `useAuth` - session state; tokens in `sessionStorage` (`session.js`).
- `RequireAuth` - route guard; redirects to `/login` and back after sign-in.
- Pages: `RegisterPage`, `LoginPage`, `VerifyEmailPage`, `ResetPasswordPage`.
- `messages.js` - API error code -> user text. All HTTP calls live in `src/services/api.js`.

API contract: `docs/api/contracts/auth.md`.
