require("dotenv").config();
const { chromium } = require("playwright");
const { Telegraf } = require("telegraf");

const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, AMAZON_AFILIADO_TAG } = process.env;

function parsing(texto) {
    if (!texto || texto.includes('/') || texto.includes('(')) return null;
    const n = parseFloat(texto.replace(/[^\d,]/g, "").replace(",", "."));
    // Em TI, raramente algo de valor custa menos de R$ 10,00. Isso ajuda a filtrar cabos inúteis ou erros.
    return (n && n > 10.0) ? n : null;
}

async function rodarBot() {
    console.log("🚀 Iniciando Crawler focado em TI...");
    
    const browser = await chromium.launch({ headless: true }); 
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        locale: 'pt-BR'
    });
    const page = await context.newPage();

    try {
        console.log("🔍 Buscando ofertas de Informática e Eletrônicos...");
        // URL filtrada para Eletrônicos e Informática com ofertas ativas
        const urlTI = "https://www.amazon.com.br/s?k=informatica&i=electronics&rh=p_n_deal_type%3A23565420011";
        
        await page.goto(urlTI, { waitUntil: "load" });
        
        await page.evaluate(() => window.scrollBy(0, 1000));
        await page.waitForTimeout(5000); 

        const ofertas = await page.evaluate(() => {
            const results = [];
            const blocos = document.querySelectorAll('.s-result-item[data-asin]');

            blocos.forEach(bloco => {
                const asin = bloco.getAttribute('data-asin');
                if (!asin) return;

                const link = bloco.querySelector('a[href*="/dp/"]');
                const titulo = bloco.querySelector('h2')?.innerText;
                const img = bloco.querySelector('img')?.src;
                
                // Preço Atual
                const precoAtualEl = bloco.querySelector('.a-price .a-offscreen');
                
                // Preço Original (O "De:" que o pessoal de TI ama comparar)
                const precoOriginalEl = bloco.querySelector('.a-text-price .a-offscreen') || 
                                        bloco.querySelector('.basisPrice .a-offscreen') ||
                                        bloco.querySelector('span[data-a-strike="true"]');

                if (link && titulo && precoAtualEl) {
                    results.push({
                        titulo: titulo.trim(),
                        url: link.href.split('?')[0],
                        atual: precoAtualEl.innerText,
                        antigo: precoOriginalEl ? precoOriginalEl.innerText : null,
                        img: img
                    });
                }
            });
            return results;
        });

        console.log(`📦 Itens de TI encontrados: ${ofertas.length}`);

        if (ofertas.length === 0) return;

        const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
        
        for (const item of ofertas.slice(0, 8)) {
            const nAtual = parsing(item.atual);
            const nAntigo = parsing(item.antigo);
            const temDesconto = nAntigo && nAntigo > nAtual;

            const linkFinal = `${item.url}?tag=${AMAZON_AFILIADO_TAG}`;
            
            // Layout de mensagem mais "Tech"
            let msg = `💻 <b>OFERTA TECH DETECTADA</b> 💻\n\n`;
            
            if (temDesconto) {
                const perc = Math.round(((nAntigo - nAtual) / nAntigo) * 100);
                msg += `🚀 <b>PROMO: ${perc}% OFF</b>\n`;
            }

            msg += `🛒 <b>${item.titulo.substring(0, 85)}...</b>\n\n`;
            
            if (temDesconto) {
                msg += `❌ De: <s>${item.antigo}</s>\n`;
            }
            
            msg += `✅ <b>Por: ${item.atual}</b>\n\n`;
            msg += `🔗 <a href="${linkFinal}">LINK DA OFERTA</a>`;

            try {
                if (item.img) {
                    await bot.telegram.sendPhoto(TELEGRAM_CHANNEL_ID, item.img, { caption: msg, parse_mode: "HTML" });
                } else {
                    await bot.telegram.sendMessage(TELEGRAM_CHANNEL_ID, msg, { parse_mode: "HTML" });
                }
                console.log(`✅ Postado: ${item.titulo.substring(0, 15)}`);
                await new Promise(r => setTimeout(r, 45000)); 
            } catch (e) {
                console.log("❌ Erro Telegram");
            }
        }
    } finally {
        await browser.close();
        console.log("🏁 Ciclo TI finalizado.");
    }
}

rodarBot();