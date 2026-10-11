# 🚀 VSL Verifier v2.0 — Framework Universal de Implementação
> **Documento Portátil de Contexto e Execução.**
> Este arquivo foi desenhado para ser fornecido a **qualquer Inteligência Artificial ou desenvolvedor** para que eles entendam 100% do projeto instantaneamente e implementem as mudanças sem cometer erros ou quebrar o que já funciona.

---

## 🎯 1. Visão de Negócio & O Problema Real

### O que o sistema faz?
O **VSL Verifier** é uma ferramenta de espionagem e validação de páginas de vendas (Marketing Digital / Tráfego Pago). 
O usuário envia a URL de uma página de vendas e o sistema deve:
1. Acessar a página como se fosse uma pessoa real (no celular ou computador).
2. Descobrir se a página tem vídeo de vendas (VSL).
3. Identificar qual é o player: **Vturb (ConverteAI)**, **PandaVideo**, **Wistia** ou **YouTube**.
4. **O grande desafio**: Páginas de vendas profissionais usam "vídeos-isca" (vídeos falsos/pequenos para enganar bots) e colocam a VSL real com atraso (delay) ou após um clique. Além disso, muitas páginas ficam atrás da proteção da **Cloudflare**, que barra robôs comuns com telas de verificação ("Just a moment...").

### A Dor Atual:
Atualmente, quando uma página usa proteção da Cloudflare, o sistema não consegue passar da tela de bloqueio e diz falsamente que "não encontrou vídeo". Queremos usar o poder do **Scrapling** (framework open-source especializado em passar invisível por essas proteções) para que o sistema consiga entrar na página, simular o clique e pegar o link real da VSL.

---

## 🏗️ 2. A Solução Arquitetural (O "Como Fazer")

Para não quebrar o que você já tem funcionando e garantir velocidade:

```
[ Usuário / Frontend ]
         │ (Envia a URL)
         ▼
[ Gateway Node.js (Express) ] ── (Porta 3000)
   1. Valida se a URL é segura (Proteção contra hackers/SSRF)
   2. Tenta um acesso ultra-rápido (Fast HTTP - menos de 2 segundos)
      └── Se achou o vídeo direto no código: JÁ RESPONDE! ⚡
   3. Se a página tem Cloudflare ou precisa rodar scripts:
      └── Aciona o Robô Especialista (Scrapling Python)
         │
         ▼
[ Worker Invisível (Python + Scrapling) ] ── (Porta interna 5001)
   - Usa o motor especial StealthyFetcher (Camoufox)
   - Passa pela Cloudflare Turnstile automaticamente sem ser bloqueado
   - Clica no player de vídeo
   - Captura todas as chamadas de rede (m3u8, mp4, configs) de todos os iframes
   - Devolve a lista de requisições e a estrutura visual da página
         │
         ▼
[ Motor de Decisão (Scoring Engine no Node.js) ]
   - Filtra os vídeos encontrados (Vturb, Panda, Wistia, YouTube)
   - Aplica a Regra de Ouro do Marketing: se um vídeo apareceu 3+ segundos depois dos outros, ele é a VSL real!
   - Retorna o resultado perfeito no mesmo formato que seu sistema já espera.
```

---

## 📋 3. Regras Sagradas (O Que NUNCA Deve Ser Quebrado)

Qualquer IA ou programador que for codar DEVE respeitar estas regras:
1. **Não mudar a API pública**: O endpoint `POST /api/verificar-vsl` deve continuar recebendo `{ "url": "...", "useMobileUA": true, "useUSAProxy": false }` e retornando exatamente o mesmo JSON com `status`, `totalCandidatos`, `candidatos`, `melhorPalpite`, `recomendacao` e `diagnosticoBruto`.
2. **Preservar a inteligência dos 4 players**:
   - **Vturb**: Extrair `accountUuid`, `videoId` e gerar o link `https://cdn.converteai.net/{accountUuid}/{videoId}/main.m3u8`.
   - **Wistia**: Extrair `mediaId`, consultar os metadados e pegar o MP4 de melhor qualidade.
   - **PandaVideo**: Pegar o link `.m3u8` direto da CDN Bunny.
   - **YouTube**: Pegar o link `watch?v=...`.
3. **Preservar o Proxy dos EUA**: As opções de anti-cloaking via `PROXY_USA_SERVER` devem funcionar tanto no modo rápido quanto no modo stealth.

---

## 🛠️ 4. Roteiro de Execução Passo a Passo (Plano de Ação)

Dividimos a implementação em **4 Passos Práticos**:

### Passo 1: Organizar as Gavetas (Modularização em Node.js)
Separar o arquivo gigante atual (`server.js`) em pequenos módulos fáceis de manter:
- `src/security/ssrf.js` (Proteção para não deixar o robô acessar IPs perigosos)
- `src/detectors/` (Uma pastinha com um arquivo para cada player: Vturb, Wistia, Panda, YouTube)
- `src/scoring/scoring.js` (O juiz que escolhe qual vídeo é a VSL real)

### Passo 2: Criar o Robô Invisível (Worker Python Scrapling)
Criar uma pasta `scraper_service/`:
- `requirements.txt`: com `scrapling[stealth]`, `fastapi`, `uvicorn`.
- `service.py`: Um servidorzinho local super leve que roda na porta interna `5001` e só tem uma função: receber a URL do Node, passar pela Cloudflare usando o `StealthyFetcher`, clicar no vídeo e devolver o que a rede capturou.

### Passo 3: Criar o Orquestrador Inteligente
No Node.js:
- Fazer a tentativa rápida primeiro (Fast HTTP).
- Se a página pedir Cloudflare ou for dinâmica, chamar o robô Python do Passo 2.
- Rodar os detectores e entregar a resposta para o usuário.

### Passo 4: Atualizar o Docker para Rodar Tudo Junto
Ajustar o `Dockerfile` para subir o Node e o Python juntos no mesmo container, de modo que você faça deploy com 1 clique no Railway, Render ou VPS.

---

## 🤖 5. O "Prompt Mestre" para Passar para Qualquer IA (Instrução de Execução)

Quando você for pedir para a IA codar (seja eu no próximo passo, ChatGPT, Claude ou Cursor), basta colar o bloco abaixo:

```text
Você é o Engenheiro Sênior responsável por implementar a atualização v2.0 do projeto VSL Verifier localizado em C:\Projetos\viva-vsl-verifier.

Consulte e siga rigorosamente o documento de especificação técnica e regras de negócio:
VSL_VERIFIER_FRAMEWORK.md

Seu objetivo é:
1. Modularizar o server.js em src/ sem alterar o contrato de entrada e saída da API (POST /api/verificar-vsl).
2. Implementar a proteção SSRF em src/security/ssrf.js.
3. Isolar os 4 detectores em src/detectors/ (Vturb, Wistia, PandaVideo, YouTube) mantendo 100% da lógica de extração e resolução de MP4 da Wistia.
4. Criar o worker local Python em scraper_service/ usando Scrapling (StealthyFetcher com Camoufox) para bypass de Cloudflare e captura de rede de iframes cross-origin.
5. Criar o orquestrador que tenta Fast HTTP estático antes e aciona o Scrapling se necessário.
6. Manter concorrência controlada via variável SCRAPER_CONCURRENCY e suporte a PROXY_USA_SERVER.
7. Atualizar o Dockerfile e requirements.txt para um container multi-runtime (Node 20 + Python Scrapling) com healthcheck.

Implemente os arquivos de forma limpa, robusta e pronta para produção.
```
