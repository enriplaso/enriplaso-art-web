"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = require("node:fs/promises");
const path = __importStar(require("node:path"));
const API_URL = process.env.IMPORT_API_URL ?? 'http://localhost:3001';
async function main() {
    const folder = process.argv[2];
    const email = process.env.IMPORT_ADMIN_EMAIL;
    const password = process.env.IMPORT_ADMIN_PASSWORD;
    if (!folder || !email || !password) {
        throw new Error('Usage: IMPORT_ADMIN_EMAIL=... IMPORT_ADMIN_PASSWORD=... npm run import:artworks -w apps/api -- <folder>');
    }
    const manifest = JSON.parse(await (0, promises_1.readFile)(path.join(folder, 'manifest.json'), 'utf8'));
    const cookie = await login(email, password);
    let created = 0;
    let skipped = 0;
    for (const entry of manifest) {
        const res = await fetch(`${API_URL}/products`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({
                slug: entry.slug,
                title: entry.title,
                medium: entry.medium,
                yearCreated: entry.yearCreated,
                widthCm: entry.widthCm,
                heightCm: entry.heightCm,
                priceCents: 0,
            }),
        });
        if (res.status === 409) {
            console.log(`skip    ${entry.slug} (already exists)`);
            skipped++;
            continue;
        }
        const product = (await expectOk(res, `create ${entry.slug}`));
        const form = new FormData();
        const bytes = await (0, promises_1.readFile)(path.join(folder, entry.image));
        form.append('file', new Blob([bytes], { type: mimeType(entry.image) }), entry.image);
        form.append('isPrimary', 'true');
        if (entry.altText)
            form.append('altText', entry.altText);
        await expectOk(await fetch(`${API_URL}/products/${product.id}/images`, {
            method: 'POST',
            headers: { Cookie: cookie },
            body: form,
        }), `upload image for ${entry.slug}`);
        await expectOk(await fetch(`${API_URL}/products/${product.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({ status: 'published' }),
        }), `publish ${entry.slug}`);
        console.log(`created ${entry.slug}`);
        created++;
    }
    console.log(`\nDone: ${created} created, ${skipped} skipped.`);
}
async function login(email, password) {
    const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    const body = (await expectOk(res, 'login'));
    if (body.requiresTwoFactor) {
        throw new Error('This admin has 2FA enabled; use one without it.');
    }
    const session = res.headers
        .getSetCookie()
        .find((c) => c.startsWith('access_token='));
    if (!session) {
        throw new Error('Login succeeded but no session cookie was set');
    }
    return session.split(';')[0];
}
async function expectOk(res, what) {
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`${what} failed: ${res.status} ${text}`);
    }
    return text ? JSON.parse(text) : undefined;
}
function mimeType(file) {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.png')
        return 'image/png';
    if (ext === '.webp')
        return 'image/webp';
    return 'image/jpeg';
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
//# sourceMappingURL=import-artworks.js.map