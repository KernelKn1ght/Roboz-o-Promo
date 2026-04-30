# Bot Amazon Afiliado + Telegram

Bot de automacao em Node.js para monitorar ofertas da Amazon Brasil, converter links para afiliado e publicar no Telegram com layout otimizado para canal/grupo.

## O que este bot faz

- Faz scraping de ofertas em `https://www.amazon.com.br/ofertas` com fallback de navegacao.
- Extrai dados dos produtos: titulo, imagem, preco atual, preco anterior e percentual de desconto.
- Converte URL de produto para link de afiliado, removendo rastreios e aplicando `tag=SUA_TAG-20`.
- Publica no Telegram com:
  - foto do produto
  - cabecalho chamativo
  - categoria detectada
  - `De:` e `Por:`
  - status de frete
  - botao `Ver Oferta`
- Aplica filtros antes do envio:
  - apenas links de produto validos Amazon (`/dp/` ou `/gp/product/`)
  - bloqueio de itens que normalmente nao comissionam (gift card, recarga, assinatura, etc.)
  - desconto minimo configuravel (padrao: acima de 10%)
- Roda em agendamento com `node-cron`.
- Evita execucoes simultaneas (`isJobRunning`), impedindo overlap de jobs.

## Stack

- `node` (CommonJS)
- `playwright` (scraping headless + user-agent real)
- `telegraf` (Telegram Bot API)
- `node-cron` (agendamento)
- `dotenv` (variaveis de ambiente)

## Estrutura do projeto

```text
bot-amazon-afiliado/
├── src/
│   └── index.js
├── package.json
├── .env
└── README.md
```

## Requisitos

- Node.js 18+
- NPM 9+
- Token de bot do Telegram (BotFather)
- Canal/grupo com o bot adicionado e permissao de envio

## Instalacao

```bash
npm install
npx playwright install chromium
```

## Configuracao (.env)

Crie um arquivo `.env` na raiz:

```env
TELEGRAM_BOT_TOKEN=SEU_BOT_TOKEN
TELEGRAM_CHANNEL_ID=@seu_canal_ou_-1001234567890
AMAZON_AFILIADO_TAG=SUA_TAG-20

# A cada quantos minutos buscar novas ofertas (cron)
SCRAPE_INTERVAL_CRON=*/5 * * * *

# Pausa entre envios de cada produto para o Telegram
OFFER_SEND_DELAY_MINUTES=3.5

# So envia ofertas com desconto acima deste valor (nao inclui igual)
MIN_DISCOUNT_PERCENT=10
```

## Como executar

```bash
npm start
```

Fluxo ao iniciar:

1. Executa uma coleta imediatamente.
2. Envia ofertas encontradas (respeitando delay entre produtos).
3. Agenda novas buscas conforme `SCRAPE_INTERVAL_CRON`.

## Formato da mensagem enviada

Exemplo de estrutura da legenda:

- `OFERTA RELAMPAGO AMAZON`
- `% de desconto - categoria`
- nome do produto
- `De: R$ ...`
- `Por: R$ ...`
- `Frete: Gratis/Nao gratis/Nao informado`

Com botao inline:

- `Ver Oferta` -> link com sua `tag` de afiliado.

## Regras de afiliado

A funcao de conversao:

1. Recebe a URL original.
2. Remove todos os parametros de query existentes.
3. Adiciona apenas `tag=<SUA_TAG-20>`.

Exemplo:

```text
Original: https://www.amazon.com.br/dp/B0XXXXXXX?smid=...&psc=1
Final:    https://www.amazon.com.br/dp/B0XXXXXXX?tag=sua_tag-20
```

## Ajustes rapidos

- Quer buscar com mais frequencia? Ajuste `SCRAPE_INTERVAL_CRON`.
- Quer enviar mais devagar/rapido? Ajuste `OFFER_SEND_DELAY_MINUTES`.
- Quer ser mais agressivo no filtro? Aumente `MIN_DISCOUNT_PERCENT`.
- Quer mudar categorias-alvo? Edite `CATEGORY_KEYWORDS` em `src/index.js`.

## Troubleshooting

- **`400: Bad Request: chat not found`**
  - `TELEGRAM_CHANNEL_ID` incorreto, ou bot sem permissao no canal/grupo.
- **Nao envia nada**
  - Filtro de desconto/categoria pode estar restritivo.
  - Verifique logs de `Ofertas encontradas`.
- **Playwright falha no inicio**
  - Rode `npx playwright install chromium` novamente.

## Roadmap sugerido

- Persistencia de historico para nao repetir o mesmo ASIN.
- Retry com backoff para envios Telegram.
- Logs estruturados (pino/winston) + observabilidade.
- Dockerfile para deploy simples em VPS.

## Aviso

Este projeto utiliza scraping. Respeite os termos de uso da plataforma alvo e a politica do Programa de Afiliados da Amazon.
