import { describe, expect, it } from 'vitest';
import {
    alpha,
    alphanumeric,
    base64,
    bic,
    cc,
    cuid,
    cuid2,
    dateString,
    domain,
    email,
    emoji,
    epoch,
    hash,
    hex,
    hostname,
    imei,
    ip,
    isbn,
    iso,
    jsonString,
    jwt,
    mac,
    mime,
    nanoid,
    numeric,
    octal,
    phone,
    semver,
    slug,
    ulid,
    url,
    uuid,
} from '../src/validators';


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


// ─── Standalone Validators ──────────────────────────────────────────────────


describe('alpha', () => {
    it('passes for letters only', () => {
        expectPass(alpha(), 'Hello');
    });

    it('fails for numbers', () => {
        expectFail(alpha(), 'Hello123');
    });

    it('fails for empty string', () => {
        expectFail(alpha(), '');
    });

    it('fails for non-string', () => {
        expectFail(alpha(), 123);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        alpha('Custom error')('123', { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('alphanumeric', () => {
    it('passes for letters and numbers', () => {
        expectPass(alphanumeric(), 'Hello123');
    });

    it('fails for special characters', () => {
        expectFail(alphanumeric(), 'Hello!');
    });

    it('fails for empty string', () => {
        expectFail(alphanumeric(), '');
    });

    it('fails for non-string', () => {
        expectFail(alphanumeric(), 123);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        alphanumeric('Custom error')('!@#', { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('bic', () => {
    it('passes for 8-char BIC', () => {
        expectPass(bic(), 'DEUTDEFF');
    });

    it('passes for 11-char BIC', () => {
        expectPass(bic(), 'DEUTDEFF500');
    });

    it('fails for too short', () => {
        expectFail(bic(), 'DEUT');
    });

    it('fails for lowercase', () => {
        expectFail(bic(), 'deutdeff');
    });

    it('fails for non-string', () => {
        expectFail(bic(), 12345678);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        bic('Custom error')('bad', { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('cc', () => {
    it('passes for valid Visa', () => {
        expectPass(cc(), '4111111111111111');
    });

    it('passes for valid card with spaces', () => {
        expectPass(cc(), '4111 1111 1111 1111');
    });

    it('passes for valid card with dashes', () => {
        expectPass(cc(), '4111-1111-1111-1111');
    });

    it('fails for invalid checksum', () => {
        expectFail(cc(), '4111111111111112');
    });

    it('fails for too short', () => {
        expectFail(cc(), '411111');
    });

    it('fails for non-string', () => {
        expectFail(cc(), 4111111111111111);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        cc('Custom error')(123, { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('cuid', () => {
    it('passes for valid CUID', () => {
        expectPass(cuid(), 'clh3am1g30000qwer1234abcd');
    });

    it('fails if not starting with c', () => {
        expectFail(cuid(), 'alh3am1g30000qwer1234abcd');
    });

    it('fails for too short', () => {
        expectFail(cuid(), 'c123');
    });

    it('fails for non-string', () => {
        expectFail(cuid(), 123);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        cuid('Custom error')('bad', { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('cuid2', () => {
    it('passes for valid CUID2', () => {
        expectPass(cuid2(), 'abc1234567890abcdefghijklm');
    });

    it('fails if starts with number', () => {
        expectFail(cuid2(), '1bc1234567890abcdefghijklm');
    });

    it('fails if starts with uppercase', () => {
        expectFail(cuid2(), 'Abc1234567890abcdefghijklm');
    });

    it('fails for too short', () => {
        expectFail(cuid2(), 'a123');
    });

    it('fails for non-string', () => {
        expectFail(cuid2(), 123);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        cuid2('Custom error')('bad', { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('dateString', () => {
    it('passes for ISO date', () => {
        expectPass(dateString(), '2024-01-15');
    });

    it('passes for date-time string', () => {
        expectPass(dateString(), '2024-01-15T10:30:00Z');
    });

    it('fails for invalid date', () => {
        expectFail(dateString(), 'not-a-date');
    });

    it('fails for non-string', () => {
        expectFail(dateString(), 123);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        dateString('Custom error')('bad', { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('domain', () => {
    it('passes for valid domain', () => {
        expectPass(domain(), 'example.com');
    });

    it('passes for subdomain', () => {
        expectPass(domain(), 'sub.example.com');
    });

    it('fails for IP address', () => {
        expectFail(domain(), '192.168.1.1');
    });

    it('fails for domain with spaces', () => {
        expectFail(domain(), 'exam ple.com');
    });

    it('fails for non-string', () => {
        expectFail(domain(), 123);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        domain('Custom error')('bad', { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('emoji', () => {
    it('passes for simple emoji', () => {
        expectPass(emoji(), '\u{1F600}');
    });

    it('passes for complex emoji', () => {
        expectPass(emoji(), '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}');
    });

    it('fails for text', () => {
        expectFail(emoji(), 'hello');
    });

    it('fails for non-string', () => {
        expectFail(emoji(), 123);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        emoji('Custom error')('bad', { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('epoch', () => {
    it('passes for numeric string', () => {
        expectPass(epoch(), '1704067200');
    });

    it('fails for decimal', () => {
        expectFail(epoch(), '1704067200.5');
    });

    it('fails for negative', () => {
        expectFail(epoch(), '-1704067200');
    });

    it('fails for non-string', () => {
        expectFail(epoch(), 1704067200);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        epoch('Custom error')('bad', { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('hostname', () => {
    it('passes for valid hostname', () => {
        expectPass(hostname(), 'my-server-01');
    });

    it('passes for hostname with dots', () => {
        expectPass(hostname(), 'server.example.com');
    });

    it('fails for hostname over 253 chars', () => {
        expectFail(hostname(), 'a'.repeat(254));
    });

    it('fails for hostname starting with dash', () => {
        expectFail(hostname(), '-invalid.com');
    });

    it('fails for non-string', () => {
        expectFail(hostname(), 123);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        hostname('Custom error')('-bad', { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('imei', () => {
    it('passes for valid IMEI', () => {
        expectPass(imei(), '490154203237518');
    });

    it('fails for invalid checksum', () => {
        expectFail(imei(), '490154203237519');
    });

    it('fails for wrong length', () => {
        expectFail(imei(), '12345678');
    });

    it('fails for non-string', () => {
        expectFail(imei(), 490154203237518);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        imei('Custom error')('bad', { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('isbn', () => {
    it('passes for valid ISBN-13', () => {
        expectPass(isbn(), '9780306406157');
    });

    it('passes for valid ISBN-10', () => {
        expectPass(isbn(), '0306406152');
    });

    it('passes for ISBN-10 with X', () => {
        expectPass(isbn(), '007462542X');
    });

    it('passes for ISBN with dashes', () => {
        expectPass(isbn(), '978-0-306-40615-7');
    });

    it('fails for invalid ISBN', () => {
        expectFail(isbn(), '1234567890');
    });

    it('fails for non-string', () => {
        expectFail(isbn(), 9780306406157);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        isbn('Custom error')(123, { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('jsonString', () => {
    it('passes for valid JSON object', () => {
        expectPass(jsonString(), '{"key": "value"}');
    });

    it('passes for JSON array', () => {
        expectPass(jsonString(), '[1, 2, 3]');
    });

    it('passes for JSON string', () => {
        expectPass(jsonString(), '"hello"');
    });

    it('passes for JSON number', () => {
        expectPass(jsonString(), '42');
    });

    it('fails for invalid JSON', () => {
        expectFail(jsonString(), '{invalid}');
    });

    it('fails for non-string', () => {
        expectFail(jsonString(), 123);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        jsonString('Custom error')(123, { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('jwt', () => {
    it('passes for valid JWT', () => {
        expectPass(jwt(), 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U');
    });

    it('fails for two segments', () => {
        expectFail(jwt(), 'header.payload');
    });

    it('fails for empty string', () => {
        expectFail(jwt(), '');
    });

    it('fails for non-string', () => {
        expectFail(jwt(), 123);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        jwt('Custom error')('bad', { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('mime', () => {
    it('passes for application/json', () => {
        expectPass(mime(), 'application/json');
    });

    it('passes for text/html', () => {
        expectPass(mime(), 'text/html');
    });

    it('passes for image/svg+xml', () => {
        expectPass(mime(), 'image/svg+xml');
    });

    it('fails for missing subtype', () => {
        expectFail(mime(), 'application');
    });

    it('fails for non-string', () => {
        expectFail(mime(), 123);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        mime('Custom error')('bad', { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('nanoid', () => {
    it('passes for valid NanoID', () => {
        expectPass(nanoid(), 'V1StGXR8_Z5jdHi6B-myT');
    });

    it('fails for wrong length', () => {
        expectFail(nanoid(), 'too-short');
    });

    it('fails for non-string', () => {
        expectFail(nanoid(), 123);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        nanoid('Custom error')('bad', { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('numeric', () => {
    it('passes for digits only', () => {
        expectPass(numeric(), '12345');
    });

    it('fails for letters', () => {
        expectFail(numeric(), '123abc');
    });

    it('fails for decimal', () => {
        expectFail(numeric(), '12.34');
    });

    it('fails for non-string', () => {
        expectFail(numeric(), 12345);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        numeric('Custom error')('abc', { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('octal', () => {
    it('passes for valid octal', () => {
        expectPass(octal(), '01234567');
    });

    it('fails for digit 8', () => {
        expectFail(octal(), '128');
    });

    it('fails for non-string', () => {
        expectFail(octal(), 123);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        octal('Custom error')('89', { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('phone', () => {
    it('passes for E.164 format', () => {
        expectPass(phone(), '+14155552671');
    });

    it('fails without plus', () => {
        expectFail(phone(), '14155552671');
    });

    it('fails for starting with +0', () => {
        expectFail(phone(), '+0155552671');
    });

    it('fails for non-string', () => {
        expectFail(phone(), 14155552671);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        phone('Custom error')('bad', { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('semver', () => {
    it('passes for basic semver', () => {
        expectPass(semver(), '1.0.0');
    });

    it('passes for semver with prerelease', () => {
        expectPass(semver(), '1.0.0-alpha.1');
    });

    it('passes for semver with build', () => {
        expectPass(semver(), '1.0.0+build.123');
    });

    it('fails for two segments', () => {
        expectFail(semver(), '1.0');
    });

    it('fails for non-string', () => {
        expectFail(semver(), 100);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        semver('Custom error')('bad', { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('slug', () => {
    it('passes for valid slug', () => {
        expectPass(slug(), 'my-cool-post');
    });

    it('passes for single word', () => {
        expectPass(slug(), 'hello');
    });

    it('fails for uppercase', () => {
        expectFail(slug(), 'My-Post');
    });

    it('fails for consecutive dashes', () => {
        expectFail(slug(), 'my--post');
    });

    it('fails for non-string', () => {
        expectFail(slug(), 123);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        slug('Custom error')('BAD!', { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


describe('ulid', () => {
    it('passes for valid ULID', () => {
        expectPass(ulid(), '01ARZ3NDEKTSV4RRFFQ69G5FAV');
    });

    it('fails for lowercase', () => {
        expectFail(ulid(), '01arz3ndektsv4rrffq69g5fav');
    });

    it('fails for wrong length', () => {
        expectFail(ulid(), '01ARZ3NDEK');
    });

    it('fails for invalid chars (I, L, O)', () => {
        expectFail(ulid(), '01ARZ3NDEKTSV4RRFFQ69G5FAI');
    });

    it('fails for non-string', () => {
        expectFail(ulid(), 123);
    });

    it('uses custom error message', () => {
        let errors: string[] = [];

        ulid('Custom error')('bad', { push: (m) => errors.push(m) });

        expect(errors[0]).toBe('Custom error');
    });
});


// ─── Namespaced Validators ──────────────────────────────────────────────────


describe('email', () => {
    describe('general', () => {
        it('passes for valid email', () => {
            expectPass(email(), 'user@example.com');
        });

        it('fails for missing @', () => {
            expectFail(email(), 'userexample.com');
        });

        it('fails for missing domain', () => {
            expectFail(email(), 'user@');
        });

        it('fails for non-string', () => {
            expectFail(email(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            email('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('rfc5322', () => {
        it('passes for standard email', () => {
            expectPass(email.rfc5322(), 'user@example.com');
        });

        it('passes for email with dots in local', () => {
            expectPass(email.rfc5322(), 'user.name@example.com');
        });

        it('fails for double dots in local', () => {
            expectFail(email.rfc5322(), 'user..name@example.com');
        });

        it('fails for non-string', () => {
            expectFail(email.rfc5322(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            email.rfc5322('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('html5', () => {
        it('passes for standard email', () => {
            expectPass(email.html5(), 'user@example.com');
        });

        it('passes for email with special chars', () => {
            expectPass(email.html5(), 'user+tag@example.com');
        });

        it('fails for spaces', () => {
            expectFail(email.html5(), 'user @example.com');
        });

        it('fails for non-string', () => {
            expectFail(email.html5(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            email.html5('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('unicode', () => {
        it('passes for standard email', () => {
            expectPass(email.unicode(), 'user@example.com');
        });

        it('passes for unicode email', () => {
            expectPass(email.unicode(), '\u00fc@example.com');
        });

        it('fails for spaces', () => {
            expectFail(email.unicode(), 'user @example.com');
        });

        it('fails for non-string', () => {
            expectFail(email.unicode(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            email.unicode('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });
});


describe('url', () => {
    describe('general', () => {
        it('passes for http URL', () => {
            expectPass(url(), 'http://example.com');
        });

        it('passes for ftp URL', () => {
            expectPass(url(), 'ftp://files.example.com');
        });

        it('fails for no protocol', () => {
            expectFail(url(), 'example.com');
        });

        it('fails for non-string', () => {
            expectFail(url(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            url('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('http', () => {
        it('passes for http URL', () => {
            expectPass(url.http(), 'http://example.com');
        });

        it('passes for https URL', () => {
            expectPass(url.http(), 'https://example.com');
        });

        it('fails for ftp', () => {
            expectFail(url.http(), 'ftp://example.com');
        });

        it('fails for non-string', () => {
            expectFail(url.http(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            url.http('Custom error')('ftp://x', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('https', () => {
        it('passes for https URL', () => {
            expectPass(url.https(), 'https://example.com');
        });

        it('fails for http URL', () => {
            expectFail(url.https(), 'http://example.com');
        });

        it('fails for non-string', () => {
            expectFail(url.https(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            url.https('Custom error')('http://x', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });
});


describe('uuid', () => {
    describe('general', () => {
        it('passes for valid UUID', () => {
            expectPass(uuid(), '550e8400-e29b-41d4-a716-446655440000');
        });

        it('fails for missing dashes', () => {
            expectFail(uuid(), '550e8400e29b41d4a716446655440000');
        });

        it('fails for non-string', () => {
            expectFail(uuid(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            uuid('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('v4', () => {
        it('passes for valid v4 UUID', () => {
            expectPass(uuid.v4(), '550e8400-e29b-4000-a000-446655440000');
        });

        it('fails for v1 UUID used as v4', () => {
            expectFail(uuid.v4(), '550e8400-e29b-1000-a000-446655440000');
        });

        it('fails for non-string', () => {
            expectFail(uuid.v4(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            uuid.v4('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('v1', () => {
        it('passes for valid v1 UUID', () => {
            expectPass(uuid.v1(), '550e8400-e29b-1000-a000-446655440000');
        });

        it('fails for v4 UUID used as v1', () => {
            expectFail(uuid.v1(), '550e8400-e29b-4000-a000-446655440000');
        });
    });

    describe('v7', () => {
        it('passes for valid v7 UUID', () => {
            expectPass(uuid.v7(), '01902d5e-46c0-7000-8000-000000000000');
        });

        it('fails for v4 UUID used as v7', () => {
            expectFail(uuid.v7(), '550e8400-e29b-4000-a000-446655440000');
        });
    });
});


describe('ip', () => {
    describe('general', () => {
        it('passes for valid IPv4', () => {
            expectPass(ip(), '192.168.1.1');
        });

        it('passes for valid IPv6', () => {
            expectPass(ip(), '2001:0db8:85a3:0000:0000:8a2e:0370:7334');
        });

        it('fails for invalid IP', () => {
            expectFail(ip(), 'not-an-ip');
        });

        it('fails for non-string', () => {
            expectFail(ip(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            ip('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('v4', () => {
        it('passes for valid IPv4', () => {
            expectPass(ip.v4(), '192.168.1.1');
        });

        it('passes for 0.0.0.0', () => {
            expectPass(ip.v4(), '0.0.0.0');
        });

        it('passes for 255.255.255.255', () => {
            expectPass(ip.v4(), '255.255.255.255');
        });

        it('fails for octet > 255', () => {
            expectFail(ip.v4(), '256.0.0.1');
        });

        it('fails for IPv6', () => {
            expectFail(ip.v4(), '::1');
        });

        it('fails for non-string', () => {
            expectFail(ip.v4(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            ip.v4('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('v4.cidr', () => {
        it('passes for valid CIDR', () => {
            expectPass(ip.v4.cidr(), '192.168.1.0/24');
        });

        it('passes for /0', () => {
            expectPass(ip.v4.cidr(), '0.0.0.0/0');
        });

        it('passes for /32', () => {
            expectPass(ip.v4.cidr(), '192.168.1.1/32');
        });

        it('fails for /33', () => {
            expectFail(ip.v4.cidr(), '192.168.1.0/33');
        });

        it('fails for missing prefix', () => {
            expectFail(ip.v4.cidr(), '192.168.1.0');
        });

        it('fails for non-string', () => {
            expectFail(ip.v4.cidr(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            ip.v4.cidr('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('v6', () => {
        it('passes for full IPv6', () => {
            expectPass(ip.v6(), '2001:0db8:85a3:0000:0000:8a2e:0370:7334');
        });

        it('passes for shortened IPv6', () => {
            expectPass(ip.v6(), '::1');
        });

        it('passes for all zeros', () => {
            expectPass(ip.v6(), '::');
        });

        it('fails for IPv4', () => {
            expectFail(ip.v6(), '192.168.1.1');
        });

        it('fails for non-string', () => {
            expectFail(ip.v6(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            ip.v6('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('v6.cidr', () => {
        it('passes for valid CIDR', () => {
            expectPass(ip.v6.cidr(), '2001:db8::/32');
        });

        it('passes for /128', () => {
            expectPass(ip.v6.cidr(), '::1/128');
        });

        it('passes for /0', () => {
            expectPass(ip.v6.cidr(), '::/0');
        });

        it('fails for /129', () => {
            expectFail(ip.v6.cidr(), '::1/129');
        });

        it('fails for missing prefix', () => {
            expectFail(ip.v6.cidr(), '::1');
        });

        it('fails for non-string', () => {
            expectFail(ip.v6.cidr(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            ip.v6.cidr('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });
});


describe('base64', () => {
    describe('standard', () => {
        it('passes for valid base64', () => {
            expectPass(base64(), 'SGVsbG8gV29ybGQ=');
        });

        it('passes for base64 with +/', () => {
            expectPass(base64(), 'abc+def/ghi=');
        });

        it('fails for empty string', () => {
            expectFail(base64(), '');
        });

        it('fails for invalid chars', () => {
            expectFail(base64(), 'SGVsbG8@V29ybGQ=');
        });

        it('fails for non-string', () => {
            expectFail(base64(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            base64('Custom error')('', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('url', () => {
        it('passes for valid base64url', () => {
            expectPass(base64.url(), 'SGVsbG8gV29ybGQ=');
        });

        it('passes for base64url with _-', () => {
            expectPass(base64.url(), 'abc_def-ghi=');
        });

        it('fails for + and /', () => {
            expectFail(base64.url(), 'abc+def/ghi=');
        });

        it('fails for non-string', () => {
            expectFail(base64.url(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            base64.url('Custom error')('', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });
});


describe('hex', () => {
    describe('general', () => {
        it('passes for valid hex', () => {
            expectPass(hex(), 'deadBEEF');
        });

        it('passes for all digits', () => {
            expectPass(hex(), '0123456789');
        });

        it('fails for non-hex chars', () => {
            expectFail(hex(), 'xyz');
        });

        it('fails for non-string', () => {
            expectFail(hex(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            hex('Custom error')('xyz', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('color', () => {
        it('passes for 3-char hex color', () => {
            expectPass(hex.color(), '#fff');
        });

        it('passes for 4-char hex color (with alpha)', () => {
            expectPass(hex.color(), '#ffff');
        });

        it('passes for 6-char hex color', () => {
            expectPass(hex.color(), '#ff00ff');
        });

        it('passes for 8-char hex color (with alpha)', () => {
            expectPass(hex.color(), '#ff00ff80');
        });

        it('fails for missing #', () => {
            expectFail(hex.color(), 'ff00ff');
        });

        it('fails for 5-char hex', () => {
            expectFail(hex.color(), '#ff00f');
        });

        it('fails for non-string', () => {
            expectFail(hex.color(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            hex.color('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });
});


describe('iso', () => {
    describe('date', () => {
        it('passes for valid date', () => {
            expectPass(iso.date(), '2024-01-15');
        });

        it('fails for invalid month', () => {
            expectFail(iso.date(), '2024-13-01');
        });

        it('fails for invalid day', () => {
            expectFail(iso.date(), '2024-01-32');
        });

        it('fails for wrong format', () => {
            expectFail(iso.date(), '01/15/2024');
        });

        it('fails for non-string', () => {
            expectFail(iso.date(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            iso.date('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('time', () => {
        it('passes for valid time', () => {
            expectPass(iso.time(), '14:30:00');
        });

        it('passes for time with milliseconds', () => {
            expectPass(iso.time(), '14:30:00.123');
        });

        it('fails for invalid hour', () => {
            expectFail(iso.time(), '25:00:00');
        });

        it('fails for invalid minute', () => {
            expectFail(iso.time(), '14:60:00');
        });

        it('fails for non-string', () => {
            expectFail(iso.time(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            iso.time('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('dateTime', () => {
        it('passes for valid date-time', () => {
            expectPass(iso.dateTime(), '2024-01-15T14:30:00');
        });

        it('passes for date-time with ms', () => {
            expectPass(iso.dateTime(), '2024-01-15T14:30:00.123');
        });

        it('fails for missing T separator', () => {
            expectFail(iso.dateTime(), '2024-01-15 14:30:00');
        });

        it('fails for non-string', () => {
            expectFail(iso.dateTime(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            iso.dateTime('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('duration', () => {
        it('passes for full duration', () => {
            expectPass(iso.duration(), 'P1Y2M3DT4H5M6S');
        });

        it('passes for date only', () => {
            expectPass(iso.duration(), 'P1Y');
        });

        it('passes for time only', () => {
            expectPass(iso.duration(), 'PT1H');
        });

        it('passes for fractional seconds', () => {
            expectPass(iso.duration(), 'PT1.5S');
        });

        it('fails for empty duration P', () => {
            expectFail(iso.duration(), 'P');
        });

        it('fails for empty PT', () => {
            expectFail(iso.duration(), 'PT');
        });

        it('fails for non-string', () => {
            expectFail(iso.duration(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            iso.duration('Custom error')('P', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('timestamp', () => {
        it('passes for UTC timestamp', () => {
            expectPass(iso.timestamp(), '2024-01-15T14:30:00Z');
        });

        it('passes for positive offset', () => {
            expectPass(iso.timestamp(), '2024-01-15T14:30:00+05:30');
        });

        it('passes for negative offset', () => {
            expectPass(iso.timestamp(), '2024-01-15T14:30:00-05:00');
        });

        it('passes for timestamp with ms', () => {
            expectPass(iso.timestamp(), '2024-01-15T14:30:00.123Z');
        });

        it('fails for no timezone', () => {
            expectFail(iso.timestamp(), '2024-01-15T14:30:00');
        });

        it('fails for non-string', () => {
            expectFail(iso.timestamp(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            iso.timestamp('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('week', () => {
        it('passes for valid week', () => {
            expectPass(iso.week(), '2024-W01');
        });

        it('passes for W53', () => {
            expectPass(iso.week(), '2024-W53');
        });

        it('fails for W00', () => {
            expectFail(iso.week(), '2024-W00');
        });

        it('fails for W54', () => {
            expectFail(iso.week(), '2024-W54');
        });

        it('fails for non-string', () => {
            expectFail(iso.week(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            iso.week('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });
});


describe('mac', () => {
    describe('general', () => {
        it('passes for MAC-48 with colons', () => {
            expectPass(mac(), '00:1A:2B:3C:4D:5E');
        });

        it('passes for MAC-64 with colons', () => {
            expectPass(mac(), '00:1A:2B:3C:4D:5E:6F:70');
        });

        it('fails for invalid format', () => {
            expectFail(mac(), 'not-a-mac');
        });

        it('fails for non-string', () => {
            expectFail(mac(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            mac('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('v48', () => {
        it('passes for MAC-48 with colons', () => {
            expectPass(mac.v48(), '00:1A:2B:3C:4D:5E');
        });

        it('passes for MAC-48 with dashes', () => {
            expectPass(mac.v48(), '00-1A-2B-3C-4D-5E');
        });

        it('fails for MAC-64', () => {
            expectFail(mac.v48(), '00:1A:2B:3C:4D:5E:6F:70');
        });

        it('fails for non-string', () => {
            expectFail(mac.v48(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            mac.v48('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('v64', () => {
        it('passes for MAC-64 with colons', () => {
            expectPass(mac.v64(), '00:1A:2B:3C:4D:5E:6F:70');
        });

        it('passes for MAC-64 with dashes', () => {
            expectPass(mac.v64(), '00-1A-2B-3C-4D-5E-6F-70');
        });

        it('fails for MAC-48', () => {
            expectFail(mac.v64(), '00:1A:2B:3C:4D:5E');
        });

        it('fails for non-string', () => {
            expectFail(mac.v64(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            mac.v64('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });
});


describe('hash', () => {
    describe('md5', () => {
        it('passes for valid MD5', () => {
            expectPass(hash.md5(), 'd41d8cd98f00b204e9800998ecf8427e');
        });

        it('fails for wrong length', () => {
            expectFail(hash.md5(), 'd41d8cd98f00b204');
        });

        it('fails for non-string', () => {
            expectFail(hash.md5(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            hash.md5('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('sha1', () => {
        it('passes for valid SHA-1', () => {
            expectPass(hash.sha1(), 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
        });

        it('fails for wrong length', () => {
            expectFail(hash.sha1(), 'da39a3ee5e6b4b0d3255');
        });

        it('fails for non-string', () => {
            expectFail(hash.sha1(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            hash.sha1('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('sha256', () => {
        it('passes for valid SHA-256', () => {
            expectPass(hash.sha256(), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
        });

        it('fails for wrong length', () => {
            expectFail(hash.sha256(), 'e3b0c44298fc1c149afbf4c8');
        });

        it('fails for non-string', () => {
            expectFail(hash.sha256(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            hash.sha256('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('sha384', () => {
        it('passes for valid SHA-384', () => {
            expectPass(hash.sha384(), '38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b');
        });

        it('fails for wrong length', () => {
            expectFail(hash.sha384(), '38b060a751ac96384cd9');
        });

        it('fails for non-string', () => {
            expectFail(hash.sha384(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            hash.sha384('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });

    describe('sha512', () => {
        it('passes for valid SHA-512', () => {
            expectPass(hash.sha512(), 'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e');
        });

        it('fails for wrong length', () => {
            expectFail(hash.sha512(), 'cf83e1357eefb8bdf1542850');
        });

        it('fails for non-string', () => {
            expectFail(hash.sha512(), 123);
        });

        it('uses custom error message', () => {
            let errors: string[] = [];

            hash.sha512('Custom error')('bad', { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Custom error');
        });
    });
});
