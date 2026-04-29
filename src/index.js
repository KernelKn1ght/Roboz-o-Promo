require("dotenv").config();
const { chromium } = require("playwright");
const { Telegraf } = require("telegraf");

const { 
    TELEGRAM_BOT_TOKEN, 
    TELEGRAM_CHANNEL_ID, 
    AMAZON_AFILIADO_TAG,
    ACTIVE_WINDOW_MINUTES = "25" 
} = process.env;

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Delay em milissegundos (3.5 min = 210000 ms)
const POST_DELAY = 3.5 * 60 * 1000;

function parsing(texto) {
    if (!texto) return null;
    const n = parseFloat(texto.replace(/[^\d,]/g, "").replace(",", "."));
    return (n && n > 30.0) ? n : null; 
}

async function buscarOfertas(page) {
    console.log("🔍 Escaneando hardware e periféricos...");
    const urlHardware = "https://www.amazon.com.br/s?k=ssd+nvme+monitor+gamer+ryzen+-livro&i=computers&rh=p_n_deal_type%3A23565420011";
    
    try {
        await page.goto(urlHardware, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(8000); 
        await page.evaluate(() => window.scrollBy(0, 1000));

        return await page.evaluate(() => {
            const results = [];
            const blocos = document.querySelectorAll('.s-result-item[data-asin]');
            const lixo = ["livro", "book", "capa comum", "guia", "apostila", "ebook", "kindle"];

            blocos.forEach(bloco => {
                const asin = bloco.getAttribute('data-asin');
                const tituloEl = bloco.querySelector('h2');
                const titulo = tituloEl?.innerText || "";

                if (!asin || asin.length < 5 || lixo.some(t => titulo.toLowerCase().includes(t))) return;

                const linkEl = bloco.querySelector('a[href*="/dp/"]');
                const imgEl = bloco.querySelector('img.s-image');
                const atualEl = bloco.querySelector('.a-price .a-offscreen');
                const antigoEl = bloco.querySelector('.a-text-price .a-offscreen') || 
                                 bloco.querySelector('.basisPrice .a-offscreen');

                if (linkEl && atualEl) {
                    results.push({
                        asin,
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
    } catch (e) {
        console.log("⚠️ Erro ao carregar página, tentando novamente...");
        return [];
    }
}

async function rodarBot() {
    const startTime = Date.now();
    const durationLimit = parseInt(ACTIVE_WINDOW_MINUTES) * 60 * 1000;
    
    console.log(`🚀 Iniciando ciclo de ${ACTIVE_WINDOW_MINUTES} minutos.`);
    console.log(`⏱️ Intervalo de postagem: 3.5 minutos.`);
    
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0...', locale: 'pt-BR' });
    const page = await context.newPage();

    while (Date.now() - startTime < durationLimit) {
        const ofertas = await buscarOfertas(page);
        
        if (ofertas.length > 0) {
            console.log(`📦 ${ofertas.length} itens encontrados. Iniciando sequência de postagem...`);
            
            for (const item of ofertas) {
                // Verifica se ainda estamos dentro do tempo de 25min antes de postar
                if (Date.now() - startTime >= durationLimit) break;

                const vAtual = parsing(item.atual);
                const vAntigo = parsing(item.antigo);
                const linkFinal = `${item.url}?tag=${AMAZON_AFILIADO_TAG}`;

                let msg = `⚙️ <b>HARDWARE TECH</b> ⚙️\n\n`;
                msg += `📦 <b>${item.titulo.substring(0, 85)}...</b>\n\n`;
                if (vAntigo && vAntigo > vAtual) msg += `<s>De: ${item.antigo}</s>\n`;
                msg += `💰 <b>Por: ${item.atual}</b>\n\n`;
                msg += `🔗 <a href="${linkFinal}">LINK DA PEÇA</a>`;

                try {
                    if (item.img) await bot.telegram.sendPhoto(TELEGRAM_CHANNEL_ID, item.img, { caption: msg, parse_mode: "HTML" });
                    else await bot.telegram.sendMessage(TELEGRAM_CHANNEL_ID, msg, { parse_mode: "HTML" });
                    
                    console.log(`✅ Postado: ${item.asin}. Próximo em 3.5 min...`);
                    
                    // O pulo do gato: Espera 3.5 minutos antes da próxima oferta
                    await new Promise(r => setTimeout(r, POST_DELAY));
                } catch (e) {
                    console.log("❌ Erro no Telegram, tentando seguir...");
                }
            }
        } else {
            console.log("😴 Nenhuma oferta nova. Aguardando 1 minuto para re-scan...");
            await new Promise(r => setTimeout(r, 60000));
        }
    }

    await browser.close();
    console.log("🏁 Janela de 25 minutos finalizada.");
}

rodarBot();