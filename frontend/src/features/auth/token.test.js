import { describe, expect, it } from 'vitest';
import { tokenFromFragment } from './token';
describe('email link token', () => {
    it('reads only a nonempty token from the fragment', () => {
        expect(tokenFromFragment('#token=one-time%2Bvalue')).toBe('one-time+value');
        expect(tokenFromFragment('#token=')).toBeNull();
        expect(tokenFromFragment('#other=value')).toBeNull();
    });
});
