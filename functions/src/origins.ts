/**
 * The page's origins: published mini-apps, the dev domain, and a local dev server, plus any tunnel to
 * the dev server while trying the page in the app (`EXTRA_ORIGINS`, comma-separated, in functions/.env).
 * The emulator answers every origin regardless; this list applies once deployed.
 */
export const allowedOrigins = (extra = process.env.EXTRA_ORIGINS ?? ''): Array<string | RegExp> => [
    /^https:\/\/[a-z0-9-]+\.apps\.chatic\.io$/,
    /^https:\/\/[a-z0-9-]+\.apps-dev\.chatic\.io$/,
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/,
    ...extra
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean),
];

export const isAllowed = (origin: string, list = allowedOrigins()): boolean =>
    list.some(allowed => (typeof allowed === 'string' ? allowed === origin : allowed.test(origin)));
