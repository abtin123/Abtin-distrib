import { handleDoH } from '@handlers/doh';
import { renderError } from '@handlers/error';
import { handleLogin } from '@handlers/login';
import { handlePanel } from '@handlers/panel';
import { handleProxyIPs } from '@handlers/proxy-ip';
import { generateQRCode } from '@handlers/qrcode';
import { handleSubscriptions } from '@handlers/subscription';
import { handleTelegram } from '@handlers/telegram';
import { fallback } from '@handlers/utils';
import { handleWebsocket } from '@handlers/websocket';
import { init, getGlobals } from '@settings';

export default {
	async fetch(request: Request, env: Env) {
		try {
			init(request, env);
			if (request.headers.get('Upgrade') === 'websocket') return handleWebsocket(request);
			const { securePath, pathname } = getGlobals();
			const path = pathname.split('/').splice(0, 3).join('/');

			switch (path) {
				case `/${securePath}/panel`:
					return handlePanel(request, env);

				case `/${securePath}/login`:
					return handleLogin(request, env);

				case `/${securePath}/sub`:
					return handleSubscriptions(request, env);

				case `/${securePath}/telegram`:
					return handleTelegram(request, env);

				case `/${securePath}/dns-query`:
					return handleDoH(request);

				case `/${securePath}/proxy-ip`:
					return handleProxyIPs(request, env);
				
				case `/${securePath}/qrcode`:
					return generateQRCode(request);
					
				default:
					return fallback(request);
			}
		} catch (error) {
            // Keep the original exception visible in Cloudflare Logs. The error
            // renderer has its own fallback, but guard it as a final safety net.
            console.error('[BPB] Unhandled Worker request error:', error);
            try {
                return await renderError(error);
            } catch (renderFailure) {
                console.error('[BPB] Error renderer failed:', renderFailure);
                const message = error instanceof Error ? error.message : String(error);
                return new Response(`BPB Worker internal error: ${message}`, {
                    status: 500,
                    headers: {
                        'Content-Type': 'text/plain; charset=utf-8',
                        'Cache-Control': 'no-store',
                        'X-Content-Type-Options': 'nosniff'
                    }
                });
            }
		}
	}
}