require("dotenv").config();
const { chromium } = require("playwright");
const { Telegraf } = require("telegraf");

const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, AMAZON_AFILIADO_TAG } = process.env;

function parsing(texto) {
    if (!texto || texto.includes('/') || texto.includes('(')) return null;
    const n = parseFloat(texto.replace(/[^\d,]/g, "").replace(",", "."));
    return (n && n > 0.5) ? n : null;
}

async function rodarBot() {
    console.log("🚀 Iniciando Deep Search...");
    // Adicionamos argumentos para evitar detecção e melhorar performance no Linux
    const browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        console.log("🔍 Acessando Amazon...");
        // MUDANÇA: 'commit' dispara assim que os dados chegam, sem esperar trackers
        await page.goto("https://www.amazon.com.br/s?k=ofertas+do+dia&i=electronics", { 
            waitUntil: "commit", 
            timeout: 60000 
        });
        
        // Espera manual controlada
        await page.waitForLoadState("domcontentloaded");
        console.log("⏳ Aguardando renderização dos preços...");
        await page.waitForTimeout(10000); 
        await page.evaluate(() => window.scrollBy(0, 1000));

        const ofertas = await page.evaluate(() => {
            const results = [];
            const items = document.querySelectorAll('.s-result-item[data-asin]');

            items.forEach(item => {
                const link = item.querySelector('a[href*="/dp/"]');
                const titulo = item.querySelector('h2')?.innerText;
                const img = item.querySelector('img')?.src;
                
                const precoAtualEl = item.querySelector('.a-price:not([data-a-unit]) .a-offscreen');
                const precoAtualTexto = precoAtualEl ? precoAtualEl.innerText : null;

                let precoAntigoTexto = null;
                const fallbackDe = item.querySelector('.a-text-price span[aria-hidden="true"]') || 
                                   item.querySelector('.basisPrice .a-offscreen') ||
                                   item.querySelector('.a-price.a-text-price .a-offscreen') ||
                                   item.querySelector('.a-text-strike');

                if (fallbackDe) {
                    precoAntigoTexto = fallbackDe.innerText;
                } else {
                    const todosSpans = Array.from(item.querySelectorAll('span'));
                    const possivelDe = todosSpans.find(s => 
                        s.innerText.includes('R$') && 
                        s.innerText !== precoAtualTexto && 
                        s.innerText.length < 20
                    );
                    precoAntigoTexto = possivelDe ? possivelDe.innerText : null;
                }

                if (link && titulo && precoAtualTexto) {
                    results.push({
                        titulo: titulo.trim().split('\n')[0],
                        url: link.href.split('?')[0],
                        atual: precoAtualTexto,
                        antigo: precoAntigoTexto,
                        img: img
                    });
                }
            });
            return results;
        });

        console.log(`📦 Itens encontrados: ${ofertas.length}`);

        if (ofertas.length === 0) return;

        const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
        for (const item of ofertas.slice(0, 10)) {
            const nAtual = parsing(item.atual);
            const nAntigo = parsing(item.antigo);
            const temDescontoReal = nAntigo && nAntigo > nAtual;

            const linkAfiliado = `${item.url}?tag=${AMAZON_AFILIADO_TAG}`;
            let msg = `🛒 <b>ACHADO DA VEZ</b> 🛒\n\n`;
            
            if (temDescontoReal) {
                const perc = Math.round(((nAntigo - nAtual) / nAntigo) * 100);
                msg += `🔥 <b>${perc}% de DESCONTO!</b>\n`;
            }

            msg += `📦 <b>${item.titulo.substring(0, 100)}</b>\n\n`;
            if (temDescontoReal) msg += `<s>De: ${item.antigo}</s>\n`;
            msg += `💰 <b>Por: ${item.atual}</b>\n\n`;
            msg += `🔗 <a href="${linkAfiliado}">VER NA AMAZON</a>`;

            try {
                if (item.img) await bot.telegram.sendPhoto(TELEGRAM_CHANNEL_ID, item.img, { caption: msg, parse_mode: "HTML" });
                else await bot.telegram.sendMessage(TELEGRAM_CHANNEL_ID, msg, { parse_mode: "HTML" });
                
                console.log(`✅ Postado: ${item.titulo.substring(0, 15)}`);
                await new Promise(r => setTimeout(r, 60000));
            } catch (e) { console.log("⚠️ Erro Telegram"); }
        }
    } catch (err) {
        console.error("❌ Erro capturado:", err.message);
    } finally {
        await browser.close();
        console.log("🏁 Ciclo finalizado.");
    }
}

rodarBot();