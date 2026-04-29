require("dotenv").config();
const { chromium } = require("playwright");
const { Telegraf } = require("telegraf");

const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, AMAZON_AFILIADO_TAG } = process.env;

function parsing(texto) {
    if (!texto || texto.includes('/') || texto.includes('(')) return null;
    const n = parseFloat(texto.replace(/[^\d,]/g, "").replace(",", "."));
    return (n && n > 1.0) ? n : null;
}

async function rodarBot() {
    console.log("🚀 Iniciando busca com Seletores de Atributo...");
    
    // Local: headless: false ajuda a ver se a Amazon jogou CAPTCHA
    const browser = await chromium.launch({ headless: true }); 
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        locale: 'pt-BR'
    });
    const page = await context.newPage();

    try {
        console.log("🔍 Acessando Amazon Brasil...");
        // Usando URL de ofertas reais (Lightning Deals e Melhores Ofertas)
        await page.goto("https://www.amazon.com.br/s?k=ofertas&rh=p_n_deal_type%3A23565420011", { 
            waitUntil: "load" 
        });
        
        console.log("⏳ Rolando para carregar elementos dinâmicos...");
        await page.evaluate(() => window.scrollBy(0, 1000));
        await page.waitForTimeout(5000); 

        const ofertas = await page.evaluate(() => {
            const results = [];
            // Focamos no container padrão de produtos da busca
            const blocos = document.querySelectorAll('.s-result-item[data-asin]');

            blocos.forEach(bloco => {
                const asin = bloco.getAttribute('data-asin');
                if (!asin || asin === "") return;

                const link = bloco.querySelector('a[href*="/dp/"]');
                const titulo = bloco.querySelector('h2')?.innerText;
                const img = bloco.querySelector('img')?.src;
                
                // --- LÓGICA DE PREÇO POR ---
                // Pegamos o span que a Amazon usa como preço principal oculto
                const precoAtualEl = bloco.querySelector('.a-price .a-offscreen');
                
                // --- LÓGICA DE PREÇO DE (Riscado) ---
                // Tentamos 4 caminhos diferentes para o preço original
                let precoOriginal = null;
                const elRiscado = bloco.querySelector('.a-text-price .a-offscreen') || 
                                  bloco.querySelector('.basisPrice .a-offscreen') ||
                                  bloco.querySelector('span[data-a-strike="true"]') ||
                                  bloco.querySelector('.a-color-secondary.a-text-strike');

                if (elRiscado) {
                    precoOriginal = elRiscado.innerText;
                }

                if (link && titulo && precoAtualEl) {
                    results.push({
                        titulo: titulo.trim(),
                        url: link.href.split('?')[0],
                        atual: precoAtualEl.innerText,
                        antigo: precoOriginal,
                        img: img
                    });
                }
            });
            return results;
        });

        console.log(`📦 Itens encontrados: ${ofertas.length}`);

        if (ofertas.length === 0) {
            console.log("⚠️ 0 itens. Verifique se a URL carregou produtos ou se há CAPTCHA.");
            return;
        }

        const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
        for (const item of ofertas.slice(0, 5)) {
            const nAtual = parsing(item.atual);
            const nAntigo = parsing(item.antigo);
            
            // Garantia de S.I.: Só exibe "De" se ele for realmente maior que o "Por"
            const temDescontoValido = nAntigo && nAntigo > nAtual;

            const linkFinal = `${item.url}?tag=${AMAZON_AFILIADO_TAG}`;
            let msg = `🛒 <b>OFERTA DETECTADA</b> 🛒\n\n`;
            
            if (temDescontoValido) {
                const perc = Math.round(((nAntigo - nAtual) / nAntigo) * 100);
                msg += `🔥 <b>${perc}% de DESCONTO!</b>\n`;
            }

            msg += `📦 <b>${item.titulo.substring(0, 100)}</b>\n\n`;
            
            if (temDescontoValido) {
                msg += `<s>De: ${item.antigo}</s>\n`;
            }
            
            msg += `💰 <b>Por: ${item.atual}</b>\n\n`;
            msg += `🔗 <a href="${linkFinal}">VER NA AMAZON</a>`;

            try {
                if (item.img) {
                    await bot.telegram.sendPhoto(TELEGRAM_CHANNEL_ID, item.img, { caption: msg, parse_mode: "HTML" });
                } else {
                    await bot.telegram.sendMessage(TELEGRAM_CHANNEL_ID, msg, { parse_mode: "HTML" });
                }
                console.log(`✅ Postado: ${item.titulo.substring(0, 20)}`);
                await new Promise(r => setTimeout(r, 30000)); // Delay menor para teste
            } catch (e) {
                console.log("❌ Erro no envio Telegram");
            }
        }
    } finally {
        await browser.close();
        console.log("🏁 Ciclo finalizado.");
    }
}

rodarBot();