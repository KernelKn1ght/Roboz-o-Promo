require("dotenv").config();
const { chromium } = require("playwright");
const { Telegraf } = require("telegraf");

const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, AMAZON_AFILIADO_TAG } = process.env;

function parsing(texto) {
    if (!texto) return null;
    const n = parseFloat(texto.replace(/[^\d,]/g, "").replace(",", "."));
    // Filtro de preço: Hardware sério raramente custa menos de R$ 30,00.
    // Isso ajuda a eliminar tranqueiras e livros baratos.
    return (n && n > 30.0) ? n : null; 
}

async function rodarBot() {
    console.log("🚀 Iniciando Crawler: HARDWARE & SETUP ONLY...");
    
    const browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
    }); 
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        locale: 'pt-BR'
    });
    const page = await context.newPage();

    try {
        console.log("🔍 Filtrando componentes e periféricos...");
        
        // URL com exclusão de termos (-livro, -capa, -guia) e focada em informática/eletrônicos
        const urlHardware = "https://www.amazon.com.br/s?k=hardware+ssd+monitor+mouse+teclado+-livro+-book+-guia+-capa&i=computers&rh=p_n_deal_type%3A23565420011";
        
        await page.goto(urlHardware, { waitUntil: "domcontentloaded" });
        
        // Espera maior para os scripts de preço riscado (o "De:") carregarem
        await page.waitForTimeout(12000); 
        await page.evaluate(() => window.scrollBy(0, 1200));

        const ofertas = await page.evaluate(() => {
            const results = [];
            const blocos = document.querySelectorAll('.s-result-item[data-asin]');

            blocos.forEach(bloco => {
                const asin = bloco.getAttribute('data-asin');
                if (!asin || asin.length < 5) return;

                const tituloEl = bloco.querySelector('h2');
                const titulo = tituloEl?.innerText || "";

                // BLACKLIST RADICAL: Se tiver qualquer termo de livraria, ignora o item.
                const lixo = ["livro", "book", "edicao", "capa comum", "brochura", "guia", "apostila", "curso", "leitura"];
                if (lixo.some(termo => titulo.toLowerCase().includes(termo))) return;

                const linkEl = bloco.querySelector('a[href*="/dp/"]');
                const imgEl = bloco.querySelector('img.s-image');

                // Preços
                const atualEl = bloco.querySelector('.a-price .a-offscreen');
                const antigoEl = bloco.querySelector('.a-text-price .a-offscreen') || 
                                 bloco.querySelector('.basisPrice .a-offscreen') ||
                                 bloco.querySelector('span[data-a-strike="true"]');

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
        
        for (const item of ofertas.slice(0, 8)) {
            const vAtual = parsing(item.atual);
            const vAntigo = parsing(item.antigo);
            const linkFinal = `${item.url}?tag=${AMAZON_AFILIADO_TAG}`;

            // Só calcula o desconto se o preço original (De:) foi capturado com sucesso
            const temDesconto = vAntigo && vAntigo > vAtual;

            let msg = `⚙️ <b>HARDWARE & SETUP</b> ⚙️\n\n`;

            if (temDesconto) {
                const perc = Math.round(((vAntigo - vAtual) / vAntigo) * 100);
                msg += `🔥 <b>MAQUINISTA: ${perc}% OFF</b>\n`;
            }

            msg += `📦 <b>${item.titulo.substring(0, 90)}...</b>\n\n`;
            
            if (temDesconto) {
                msg += `❌ De: <s>${item.antigo}</s>\n`;
            }
            msg += `💰 <b>Por: ${item.atual}</b>\n\n`;
            msg += `🔗 <a href="${linkFinal}">LINK DA OFERTA</a>`;

            try {
                if (item.img) {
                    await bot.telegram.sendPhoto(TELEGRAM_CHANNEL_ID, item.img, { caption: msg, parse_mode: "HTML" });
                } else {
                    await bot.telegram.sendMessage(TELEGRAM_CHANNEL_ID, msg, { parse_mode: "HTML" });
                }
                console.log(`✅ Postado: ${item.titulo.substring(0, 20)}`);
                await new Promise(r => setTimeout(r, 60000));
            } catch (e) { console.log("⚠️ Erro Telegram"); }
        }
    } finally {
        await browser.close();
        console.log("🏁 Operação Hardware Finalizada.");
    }
}

rodarBot();