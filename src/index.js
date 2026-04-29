require("dotenv").config();
const { chromium } = require("playwright"); // Apenas Playwright puro
const { Telegraf } = require("telegraf");

const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, AMAZON_AFILIADO_TAG } = process.env;

function parsing(texto) {
    if (!texto) return null;
    const n = parseFloat(texto.replace(/[^\d,]/g, "").replace(",", "."));
    // Foco em Hardware/Periféricos: Filtra itens abaixo de R$ 30,00
    return (n && n > 30.0) ? n : null; 
}

async function rodarBot() {
    console.log("🚀 Iniciando Crawler: HARDWARE & SETUP ONLY...");
    
    const browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    }); 

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'pt-BR'
    });

    const page = await context.newPage();

    try {
        // Evasão manual de detecção de bot
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        console.log("🔍 Filtrando componentes e periféricos...");
        // URL otimizada: foca em informática e exclui termos de livraria
        const urlHardware = "https://www.amazon.com.br/s?k=hardware+ssd+monitor+gamer+-livro+-book+-guia&i=computers&rh=p_n_deal_type%3A23565420011";
        
        await page.goto(urlHardware, { waitUntil: "domcontentloaded", timeout: 60000 });
        
        await page.waitForTimeout(10000); 
        await page.evaluate(() => window.scrollBy(0, 1000));

        const ofertas = await page.evaluate(() => {
            const results = [];
            const blocos = document.querySelectorAll('.s-result-item[data-asin]');

            blocos.forEach(bloco => {
                const asin = bloco.getAttribute('data-asin');
                if (!asin || asin.length < 5) return;

                const tituloEl = bloco.querySelector('h2');
                const titulo = tituloEl?.innerText || "";

                // Blacklist agressiva anti-livro
                const lixo = ["livro", "book", "capa comum", "guia", "apostila", "ebook", "kindle", "leitura"];
                if (lixo.some(termo => titulo.toLowerCase().includes(termo))) return;

                const linkEl = bloco.querySelector('a[href*="/dp/"]');
                const imgEl = bloco.querySelector('img.s-image');

                const atualEl = bloco.querySelector('.a-price .a-offscreen');
                const antigoEl = bloco.querySelector('.a-text-price .a-offscreen') || 
                                 bloco.querySelector('.basisPrice .a-offscreen') ||
                                 bloco.querySelector('.a-price.a-text-price span');

                if (linkEl && titulo && atualEl) {
                    results.push({
                        titulo: titulo.trim(),
                        url: linkEl.href.split('?')[0],
                        atual: atualEl.innerText,
                        antigo: antigoEl ? antigoEl.innerText : null,
                        img: imgEl ? imgEl.src : null
                    });
                }
            });
            return results;
        });

        console.log(`📦 Hardware encontrados: ${ofertas.length}`);

        if (ofertas.length === 0) return;

        const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
        for (const item of ofertas.slice(0, 5)) {
            const vAtual = parsing(item.atual);
            const vAntigo = parsing(item.antigo);
            const linkFinal = `${item.url}?tag=${AMAZON_AFILIADO_TAG}`;

            const temDesconto = vAntigo && vAntigo > vAtual;
            let msg = `⚙️ <b>HARDWARE & SETUP</b> ⚙️\n\n`;

            if (temDesconto) {
                const perc = Math.round(((vAntigo - vAtual) / vAntigo) * 100);
                msg += `🚀 <b>OFERTA: ${perc}% OFF</b>\n`;
            }

            msg += `📦 <b>${item.titulo.substring(0, 90)}...</b>\n\n`;
            if (temDesconto) msg += `<s>De: ${item.antigo}</s>\n`;
            msg += `💰 <b>Por: ${item.atual}</b>\n\n`;
            msg += `🔗 <a href="${linkFinal}">LINK DA PEÇA</a>`;

            try {
                if (item.img) await bot.telegram.sendPhoto(TELEGRAM_CHANNEL_ID, item.img, { caption: msg, parse_mode: "HTML" });
                else await bot.telegram.sendMessage(TELEGRAM_CHANNEL_ID, msg, { parse_mode: "HTML" });
                await new Promise(r => setTimeout(r, 5000)); 
            } catch (e) { console.log("Erro Telegram"); }
        }
    } finally {
        await browser.close();
        console.log("🏁 Operação Hardware Finalizada.");
    }
}

rodarBot();