export function tokenFromFragment(fragment) {
    const token = new URLSearchParams(fragment.replace(/^#/, '')).get('token');
    return token || null;
}
