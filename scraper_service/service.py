import os
import re
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn
from scrapling.fetchers import StealthyFetcher

app = FastAPI(title="VSL Verifier Stealth Worker - Scrapling Engine")

class ScrapeRequest(BaseModel):
    url: str
    useMobileUA: bool = True
    proxyUrl: Optional[str] = None
    timeoutMs: int = 65000
    solveCloudflare: bool = True

@app.get("/health")
def health():
    return {
        "status": "ok",
        "worker": "scrapling-stealth",
        "engine": "patchright-stealth-session"
    }

@app.post("/v1/stealth-scrape")
async def stealth_scrape(req: ScrapeRequest):
    network_events = []

    # 1. Listener de rede pré-navegação
    def on_page_setup(page):
        def handle_request(request):
            try:
                network_events.append({
                    "url": request.url,
                    "method": request.method,
                    "resourceType": request.resource_type
                })
            except Exception:
                pass
        page.on("request", handle_request)

    # 2. Ação na página: Human Scroll + Clique no Player
    def on_page_action(page):
        # Human scroll para ativar lazy loading e IntersectionObserver
        try:
            page.mouse.wheel(0, 400)
            page.wait_for_timeout(800)
            page.mouse.wheel(0, 800)
            page.wait_for_timeout(800)
            page.mouse.wheel(0, -600)
            page.wait_for_timeout(600)
        except Exception:
            pass

        # Tentativa de clique no seletor do player
        selectors = [
            "vturb-smartplayer",
            '[id^="vid_"]',
            '[class*="vturb"]',
            '[class*="smartplayer"]',
            '[class*="player"]',
            "video",
            'iframe[src*="converteai"]',
            'iframe[src*="pandavideo"]',
            'iframe[src*="wistia"]',
            'iframe[src*="youtube"]'
        ]

        click_done = False
        for s in selectors:
            try:
                el = page.locator(s).first
                if el.count() > 0:
                    if req.useMobileUA:
                        el.tap(timeout=3000)
                    else:
                        el.click(timeout=3000)
                    click_done = True
                    break
            except Exception:
                continue

        # Fallback para o centro da tela se nenhum seletor específico clicou
        if not click_done:
            try:
                viewport = page.viewport_size
                if viewport:
                    cx = viewport["width"] // 2
                    cy = viewport["height"] // 2
                    if req.useMobileUA:
                        page.touchscreen.tap(cx, cy)
                    else:
                        page.mouse.click(cx, cy)
            except Exception:
                pass

        # Estabilização pós-clique para permitir disparo dos pacotes de mídia
        try:
            page.wait_for_timeout(2500)
        except Exception:
            pass

    # 3. Parametrização avançada do Scrapling
    timeout_ms = max(req.timeoutMs, 60000) if req.solveCloudflare else req.timeoutMs

    proxy_config = None
    if req.proxyUrl:
        proxy_config = req.proxyUrl
    else:
        env_proxy = os.getenv("PROXY_USA_SERVER")
        if env_proxy:
            proxy_user = os.getenv("PROXY_USA_USERNAME")
            proxy_pass = os.getenv("PROXY_USA_PASSWORD")
            if proxy_user and proxy_pass:
                server = env_proxy if env_proxy.startswith("http") else f"http://{env_proxy}"
                proxy_config = {
                    "server": server,
                    "username": proxy_user,
                    "password": proxy_pass
                }
            else:
                proxy_config = env_proxy

    fetch_kwargs = {
        "headless": True,
        "network_idle": False,
        "timeout": timeout_ms,
        "page_setup": on_page_setup,
        "page_action": on_page_action,
        "block_webrtc": True,
        "hide_canvas": True,
        "google_search": True,
        "allow_webgl": True,
        "solve_cloudflare": req.solveCloudflare,
        "capture_xhr": r"(converteai|b-cdn|pandavideo|wistia|youtube|m3u8|checkout|hotmart|kiwify|eduzz|monetizze|braip|yampi)"
    }

    if proxy_config:
        fetch_kwargs["proxy"] = proxy_config

    try:
        page_result = StealthyFetcher.fetch(req.url, **fetch_kwargs)

        html_content = page_result.text if hasattr(page_result, "text") else str(page_result)

        # Mesclar eventos XHR capturados
        if hasattr(page_result, "captured_xhr") and page_result.captured_xhr:
            for xhr in page_result.captured_xhr:
                xhr_url = getattr(xhr, "url", None) or (xhr.get("url") if isinstance(xhr, dict) else str(xhr))
                if xhr_url and not any(e.get("url") == xhr_url for e in network_events):
                    network_events.append({
                        "url": xhr_url,
                        "method": "GET",
                        "resourceType": "xhr"
                    })

        return {
            "status": "ok",
            "html": html_content,
            "networkEvents": network_events,
            "challengeBypassed": True,
            "proxyUsed": bool(proxy_config)
        }

    except Exception as e:
        err_msg = str(e)
        return {
            "status": "error",
            "message": err_msg,
            "networkEvents": network_events,
            "challengeBypassed": False,
            "proxyUsed": bool(proxy_config)
        }

if __name__ == "__main__":
    port = int(os.getenv("WORKER_PORT", "5001"))
    uvicorn.run(app, host="127.0.0.1", port=port)
