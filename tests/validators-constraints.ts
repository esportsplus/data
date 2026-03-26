import { describe, expect, it } from 'vitest';

import bytes from '../src/validators/bytes';
import endsWith from '../src/validators/ends-with';
import excludes from '../src/validators/excludes';
import graphemes from '../src/validators/graphemes';
import includesStr from '../src/validators/includes-str';
import length from '../src/validators/length';
import matches from '../src/validators/matches';
import normalize from '../src/validators/normalize';
import startsWith from '../src/validators/starts-with';
import trim from '../src/validators/trim';
import words from '../src/validators/words';


function expectPass(fn: (value: unknown, errors: { push(msg: string): void }) => void, value: unknown) {
    let errors: string[] = [];

    fn(value, { push: (m) => errors.push(m) });

    expect(errors).toHaveLength(0);
}

function expectFail(fn: (value: unknown, errors: { push(msg: string): void }) => void, value: unknown) {
    let errors: string[] = [];

    fn(value, { push: (m) => errors.push(m) });

    expect(errors.length).toBeGreaterThan(0);
}


// ─── bytes ──────────────────────────────────────────────────────────────────


describe('bytes', () => {
    describe('exact', () => {
        it('passes for exact byte length (ASCII)', () => {
            expectPass(bytes(5), 'hello');
        });

        it('fails for wrong byte length', () => {
            expectFail(bytes(5), 'hi');
        });

        it('counts multi-byte characters correctly', () => {
            // '€' is 3 bytes in UTF-8
            expectPass(bytes(3), '\u20AC');
        });

        it('fails for non-string', () => {
            expectFail(bytes(5), 123);
        });

        it('passes for empty string with 0', () => {
            expectPass(bytes(0), '');
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            bytes(5, 'custom')('hi', { push: (m) => errors.push(m) });

            expect(errors).toEqual(['custom']);
        });
    });

    describe('min', () => {
        it('passes when byte length meets minimum', () => {
            expectPass(bytes.min(3), 'hello');
        });

        it('passes at exact minimum', () => {
            expectPass(bytes.min(5), 'hello');
        });

        it('fails below minimum', () => {
            expectFail(bytes.min(10), 'hi');
        });

        it('counts multi-byte characters', () => {
            // '€' is 3 bytes
            expectPass(bytes.min(3), '\u20AC');
            expectFail(bytes.min(4), '\u20AC');
        });

        it('fails for non-string', () => {
            expectFail(bytes.min(1), 42);
        });
    });

    describe('max', () => {
        it('passes when byte length within maximum', () => {
            expectPass(bytes.max(10), 'hello');
        });

        it('passes at exact maximum', () => {
            expectPass(bytes.max(5), 'hello');
        });

        it('fails above maximum', () => {
            expectFail(bytes.max(3), 'hello');
        });

        it('counts multi-byte characters', () => {
            // '€' is 3 bytes
            expectPass(bytes.max(3), '\u20AC');
            expectFail(bytes.max(2), '\u20AC');
        });

        it('fails for non-string', () => {
            expectFail(bytes.max(10), true);
        });
    });
});


// ─── words ──────────────────────────────────────────────────────────────────


describe('words', () => {
    describe('exact', () => {
        it('passes for exact word count', () => {
            expectPass(words(3), 'hello beautiful world');
        });

        it('fails for wrong word count', () => {
            expectFail(words(3), 'hello world');
        });

        it('handles empty string as 0 words', () => {
            expectPass(words(0), '');
            expectPass(words(0), '   ');
        });

        it('handles multiple spaces between words', () => {
            expectPass(words(2), 'hello   world');
        });

        it('fails for non-string', () => {
            expectFail(words(1), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            words(3, 'custom')('hi', { push: (m) => errors.push(m) });

            expect(errors).toEqual(['custom']);
        });
    });

    describe('min', () => {
        it('passes when word count meets minimum', () => {
            expectPass(words.min(2), 'hello world friend');
        });

        it('passes at exact minimum', () => {
            expectPass(words.min(2), 'hello world');
        });

        it('fails below minimum', () => {
            expectFail(words.min(3), 'hello');
        });

        it('fails for non-string', () => {
            expectFail(words.min(1), null);
        });
    });

    describe('max', () => {
        it('passes when word count within maximum', () => {
            expectPass(words.max(5), 'hello world');
        });

        it('passes at exact maximum', () => {
            expectPass(words.max(2), 'hello world');
        });

        it('fails above maximum', () => {
            expectFail(words.max(1), 'hello world');
        });

        it('fails for non-string', () => {
            expectFail(words.max(5), undefined);
        });
    });
});


// ─── graphemes ──────────────────────────────────────────────────────────────


describe('graphemes', () => {
    describe('exact', () => {
        it('passes for exact grapheme count (ASCII)', () => {
            expectPass(graphemes(5), 'hello');
        });

        it('fails for wrong grapheme count', () => {
            expectFail(graphemes(5), 'hi');
        });

        it('counts emoji as single grapheme', () => {
            expectPass(graphemes(1), '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}');
        });

        it('counts emoji with skin tone as single grapheme', () => {
            expectPass(graphemes(1), '\u{1F44B}\u{1F3FD}');
        });

        it('counts multiple graphemes correctly', () => {
            expectPass(graphemes(3), 'a\u{1F44B}\u{1F3FD}b');
        });

        it('passes for empty string with 0', () => {
            expectPass(graphemes(0), '');
        });

        it('fails for non-string', () => {
            expectFail(graphemes(1), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            graphemes(5, 'custom')('hi', { push: (m) => errors.push(m) });

            expect(errors).toEqual(['custom']);
        });
    });

    describe('min', () => {
        it('passes when grapheme count meets minimum', () => {
            expectPass(graphemes.min(2), 'hello');
        });

        it('passes at exact minimum', () => {
            expectPass(graphemes.min(5), 'hello');
        });

        it('fails below minimum', () => {
            expectFail(graphemes.min(5), 'hi');
        });

        it('fails for non-string', () => {
            expectFail(graphemes.min(1), 42);
        });
    });

    describe('max', () => {
        it('passes when grapheme count within maximum', () => {
            expectPass(graphemes.max(10), 'hello');
        });

        it('passes at exact maximum', () => {
            expectPass(graphemes.max(5), 'hello');
        });

        it('fails above maximum', () => {
            expectFail(graphemes.max(2), 'hello');
        });

        it('counts emoji as single grapheme for max', () => {
            expectPass(graphemes.max(1), '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}');
        });

        it('fails for non-string', () => {
            expectFail(graphemes.max(10), false);
        });
    });
});


// ─── length ─────────────────────────────────────────────────────────────────


describe('length', () => {
    it('passes for exact string length', () => {
        expectPass(length(5), 'hello');
    });

    it('fails for wrong string length', () => {
        expectFail(length(5), 'hi');
    });

    it('passes for empty string with 0', () => {
        expectPass(length(0), '');
    });

    it('counts UTF-16 code units (not graphemes)', () => {
        // '\u{1F600}' is 2 UTF-16 code units
        expectPass(length(2), '\u{1F600}');
    });

    it('fails for non-string', () => {
        expectFail(length(1), 123);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        length(5, 'custom')('hi', { push: (m) => errors.push(m) });

        expect(errors).toEqual(['custom']);
    });
});


// ─── startsWith ─────────────────────────────────────────────────────────────


describe('startsWith', () => {
    it('passes when string starts with prefix', () => {
        expectPass(startsWith('http'), 'http://example.com');
    });

    it('fails when string does not start with prefix', () => {
        expectFail(startsWith('https'), 'http://example.com');
    });

    it('passes for exact match', () => {
        expectPass(startsWith('hello'), 'hello');
    });

    it('passes for empty prefix', () => {
        expectPass(startsWith(''), 'anything');
    });

    it('fails for non-string', () => {
        expectFail(startsWith('test'), 123);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        startsWith('x', 'custom')('abc', { push: (m) => errors.push(m) });

        expect(errors).toEqual(['custom']);
    });
});


// ─── endsWith ───────────────────────────────────────────────────────────────


describe('endsWith', () => {
    it('passes when string ends with suffix', () => {
        expectPass(endsWith('.com'), 'example.com');
    });

    it('fails when string does not end with suffix', () => {
        expectFail(endsWith('.org'), 'example.com');
    });

    it('passes for exact match', () => {
        expectPass(endsWith('hello'), 'hello');
    });

    it('passes for empty suffix', () => {
        expectPass(endsWith(''), 'anything');
    });

    it('fails for non-string', () => {
        expectFail(endsWith('.com'), 123);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        endsWith('x', 'custom')('abc', { push: (m) => errors.push(m) });

        expect(errors).toEqual(['custom']);
    });
});


// ─── includesStr ────────────────────────────────────────────────────────────


describe('includesStr', () => {
    it('passes when string contains substring', () => {
        expectPass(includesStr('world'), 'hello world');
    });

    it('fails when string does not contain substring', () => {
        expectFail(includesStr('xyz'), 'hello world');
    });

    it('passes for exact match', () => {
        expectPass(includesStr('hello'), 'hello');
    });

    it('passes for empty substring', () => {
        expectPass(includesStr(''), 'anything');
    });

    it('fails for non-string', () => {
        expectFail(includesStr('test'), 123);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        includesStr('x', 'custom')('abc', { push: (m) => errors.push(m) });

        expect(errors).toEqual(['custom']);
    });
});


// ─── excludes ───────────────────────────────────────────────────────────────


describe('excludes', () => {
    it('passes when string does not contain substring', () => {
        expectPass(excludes('xyz'), 'hello world');
    });

    it('fails when string contains substring', () => {
        expectFail(excludes('world'), 'hello world');
    });

    it('fails for exact match', () => {
        expectFail(excludes('hello'), 'hello');
    });

    it('fails for empty substring (always included)', () => {
        expectFail(excludes(''), 'anything');
    });

    it('fails for non-string', () => {
        expectFail(excludes('test'), 123);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        excludes('l', 'custom')('hello', { push: (m) => errors.push(m) });

        expect(errors).toEqual(['custom']);
    });
});


// ─── matches ────────────────────────────────────────────────────────────────


describe('matches', () => {
    it('passes when string matches regex', () => {
        expectPass(matches(/^\d+$/), '12345');
    });

    it('fails when string does not match regex', () => {
        expectFail(matches(/^\d+$/), 'abc');
    });

    it('works with flags', () => {
        expectPass(matches(/^hello$/i), 'HELLO');
    });

    it('passes for empty string matching empty pattern', () => {
        expectPass(matches(/^$/), '');
    });

    it('fails for non-string', () => {
        expectFail(matches(/test/), 123);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        matches(/^\d+$/, 'custom')('abc', { push: (m) => errors.push(m) });

        expect(errors).toEqual(['custom']);
    });
});


// ─── trim ───────────────────────────────────────────────────────────────────


describe('trim', () => {
    describe('both', () => {
        it('passes for already trimmed string', () => {
            expectPass(trim(), 'hello');
        });

        it('fails for leading whitespace', () => {
            expectFail(trim(), '  hello');
        });

        it('fails for trailing whitespace', () => {
            expectFail(trim(), 'hello  ');
        });

        it('fails for both leading and trailing whitespace', () => {
            expectFail(trim(), '  hello  ');
        });

        it('passes for empty string', () => {
            expectPass(trim(), '');
        });

        it('passes for string with internal whitespace', () => {
            expectPass(trim(), 'hello world');
        });

        it('fails for non-string', () => {
            expectFail(trim(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            trim('Custom error')('  bad  ', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('start', () => {
        it('passes for no leading whitespace', () => {
            expectPass(trim.start(), 'hello');
        });

        it('fails for leading whitespace', () => {
            expectFail(trim.start(), '  hello');
        });

        it('passes for trailing whitespace only', () => {
            expectPass(trim.start(), 'hello  ');
        });

        it('fails for non-string', () => {
            expectFail(trim.start(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            trim.start('Custom error')('  bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('end', () => {
        it('passes for no trailing whitespace', () => {
            expectPass(trim.end(), 'hello');
        });

        it('fails for trailing whitespace', () => {
            expectFail(trim.end(), 'hello  ');
        });

        it('passes for leading whitespace only', () => {
            expectPass(trim.end(), '  hello');
        });

        it('fails for non-string', () => {
            expectFail(trim.end(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            trim.end('Custom error')('bad  ', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });
});


// ─── normalize ──────────────────────────────────────────────────────────────


describe('normalize', () => {
    describe('nfc (default)', () => {
        it('passes for NFC normalized string', () => {
            expectPass(normalize(), 'hello');
        });

        it('passes for already NFC string', () => {
            let nfc = '\u00e9'; // e with acute as single code point (NFC)

            expectPass(normalize(), nfc);
        });

        it('fails for NFD decomposed string', () => {
            let nfd = '\u0065\u0301'; // e + combining acute accent (NFD)

            expectFail(normalize(), nfd);
        });

        it('fails for non-string', () => {
            expectFail(normalize(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            normalize('Custom error')('\u0065\u0301', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('nfd', () => {
        it('passes for NFD normalized string', () => {
            let nfd = '\u0065\u0301'; // e + combining acute accent

            expectPass(normalize.nfd(), nfd);
        });

        it('fails for NFC composed string', () => {
            let nfc = '\u00e9'; // e with acute as single code point

            expectFail(normalize.nfd(), nfc);
        });

        it('passes for ASCII (same in all forms)', () => {
            expectPass(normalize.nfd(), 'hello');
        });

        it('fails for non-string', () => {
            expectFail(normalize.nfd(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            normalize.nfd('Custom error')('\u00e9', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('nfkc', () => {
        it('passes for NFKC normalized string', () => {
            expectPass(normalize.nfkc(), 'hello');
        });

        it('fails for compatibility character not in NFKC', () => {
            let compat = '\ufb01'; // fi ligature

            expectFail(normalize.nfkc(), compat);
        });

        it('fails for non-string', () => {
            expectFail(normalize.nfkc(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            normalize.nfkc('Custom error')('\ufb01', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('nfkd', () => {
        it('passes for NFKD normalized string', () => {
            expectPass(normalize.nfkd(), 'hello');
        });

        it('fails for compatibility character not in NFKD', () => {
            let compat = '\ufb01'; // fi ligature

            expectFail(normalize.nfkd(), compat);
        });

        it('fails for non-string', () => {
            expectFail(normalize.nfkd(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            normalize.nfkd('Custom error')('\ufb01', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });
});
