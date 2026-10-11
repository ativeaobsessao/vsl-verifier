import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from scrapling.fetchers import StealthyFetcher
import uvicorn

app = FastAPI(title='VSL Verifier Stealth Worker')

class ScrapeRequest(BaseModel):
    url: str
    useMobileUA: bool = True
    proxyUrl: Optional[str] = None
    timeoutMs: int = 35000

@app.get('/health')
def health():
    return {'status': 'ok', 'worker': 'scrapling-stealth'}

@app.post('/v1/stealth-scrape')
async def stealth_scrape(req: ScrapeRequest):
    network_events = []
    
    def on_page_setup(page):
        def handle_request(request):
            url = request.url
            network_events.append({
                'url': url,
                'method': request.method,
                'resourceType': request.resource_type
            })
        page.on('request', handle_request)

    def on_page_action(page):
        selectors = [
            '[id^="vid_"]',
            '[class*="vturb"]',
            '[class*="player"]',
            'video',
            'iframe'
        ]
        for s in selectors:
            try:
                el = page.locator(s).first
                if el.count() > 0:
                    if req.useMobileUA:
                        el.tap(timeout=3000)
                    else:
                        el.click(timeout=3000)
                    break
            except Exception:
                continue

    try:
        page_result = StealthyFetcher.fetch(
            req.url,
            headless=True,
            network_idle=False,
            timeout=req.timeoutMs,
            page_setup=on_page_setup,
            page_action=on_page_action
        )

        return {
            'status': 'ok',
            'html': page_result.text if hasattr(page_result, 'text') else str(page_result),
            'networkEvents': network_events,
            'challengeBypassed': True
        }
    except Exception as e:
        return {
            'status': 'error',
            'message': str(e),
            'networkEvents': network_events,
            'challengeBypassed': False
        }

if __name__ == '__main__':
    port = int(os.getenv('WORKER_PORT', '5001'))
    uvicorn.run(app, host='127.0.0.1', port=port)
