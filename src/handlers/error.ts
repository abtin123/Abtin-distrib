import { decompressGzipBase64, safeError } from '@common';

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

/**
 * Render the branded error page when possible. This function must never throw:
 * if the bundled error asset is damaged, return a plain-text 500 response instead
 * of turning the original exception into Cloudflare error 1101.
 */
export async function renderError(error: unknown): Promise<Response> {
    const message = safeError(error);

    try {
        if (typeof ERROR_HTML_CONTENT !== 'string' || !ERROR_HTML_CONTENT) {
            throw new Error('ERROR_HTML_CONTENT is missing from the built Worker.');
        }

        const str = await decompressGzipBase64(ERROR_HTML_CONTENT);
        const html = str
            .replaceAll('__ERROR_MESSAGE__', escapeHtml(message))
            .replaceAll('__ICON__', typeof ICON_CONTENT === 'string' ? ICON_CONTENT : '');

        return new Response(html, {
            status: 500,
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                'X-Content-Type-Options': 'nosniff'
            }
        });
    } catch (renderFailure) {
        console.error('[BPB] Failed to render error page:', renderFailure);
        console.error('[BPB] Original request error:', error);

        return new Response(
            `BPB Worker internal error.\n\nRequest error: ${message}\nError page failure: ${safeError(renderFailure)}\n\nCheck Worker Logs and verify the deployment assets.`,
            {
                status: 500,
                headers: {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                    'X-Content-Type-Options': 'nosniff'
                }
            }
        );
    }
}
