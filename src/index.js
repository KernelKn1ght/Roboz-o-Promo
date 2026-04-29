require("dotenv").config();
const { chromium } = require("playwright");
const { Telegraf } = require("telegraf");

const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, AMAZON_AFILIADO_TAG } = process.env;

// Função de limpeza para validar preços reais
function parsing(texto) {
    if (!texto || texto.includes('/') || texto.includes('(')) return null;
    const n = parseFloat(texto.replace(/[^\d,]/g, "").replace(",", "."));
    return (n && n > 1.0) ? n : null; // Ignora centavos (provável preço por grama)
}

async function rodarBot() {
    console.log("🚀 Iniciando em modo Evasão (GitHub Actions)...");
    
    const browser = await chromium.launch({ 
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled' // Esconde que é automação
        ] 
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'pt-BR'
    });

    const page = await context.newPage();

    try {
        console.log("🔍 Acessando Ofertas da Amazon...");
        // URL de Ofertas do Dia (mais propensa a ter o preço riscado "De")
        await page.goto("https://www.amazon.com.br/gp/goldbox", { 
            waitUntil: "domcontentloaded", 
            timeout: 60000 
        });
        
        // Espera robusta para renderização de scripts dinâmicos
        await page.waitForTimeout(15000); 
        await page.evaluate(() => window.scrollBy(0, 800));

        const ofertas = await page.evaluate(() => {
            const results = [];
            // Seletores que funcionam tanto em listas de busca quanto em páginas de oferta
            const blocos = document.querySelectorAll('[data-testid="deal-card"], .s-result-item');

            blocos.forEach(bloco => {
                const link = bloco.querySelector('a[href*="/dp/"]');
                const titulo = bloco.querySelector('h2, [class*="dealTitle"], img')?.innerText || 
                               bloco.querySelector('img')?.alt;
                const img = bloco.querySelector('img')?.src;
                
                // 1. Captura o POR (Preço Atual)
                const precoAtualEl = bloco.querySelector('.a-price:not([data-a-unit]) .a-offscreen') ||
                                     bloco.querySelector('.a-price .a-offscreen');
                
                // 2. Captura o DE (Preço Riscado) - Busca por classe ou estilo CSS
                let precoOriginal = null;
                const elRiscado = bloco.querySelector('.a-text-price .a-offscreen') || 
                                  bloco.querySelector('.basisPrice .a-offscreen') ||
                                  bloco.querySelector('.a-text-strike');

                if (elRiscado) {
                    precoOriginal = elRiscado.innerText;
                } else {
                    // Fallback: procura qualquer span que tenha o estilo "line-through" (riscado)
                    const spans = bloco.querySelectorAll('span');
                    for (let s of spans) {
                        if (s.innerText.includes('R$') && window.getComputedStyle(s).textDecoration.includes('line-through')) {
                            precoOriginal = s.innerText;
                            break;
                        }
                    }
                }

                if (link && titulo && precoAtualEl) {
                    results.push({
                        titulo: titulo.trim().split('\n')[0],
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
            console.log("⚠️ Nenhum item encontrado. Verificando bloqueio...");
            return;
        }

        const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
        // Postar apenas os 5 melhores para evitar spam/block
        for (const item of ofertas.slice(0, 5)) {
            const nAtual = parsing(item.atual);
            const nAntigo = parsing(item.antigo);
            const linkAfiliado = `${item.url}?tag=${AMAZON_AFILIADO_TAG}`;
            
            let msg = `🛒 <b>ACHADO EM OFERTA</b> 🛒\n\n`;
            
            if (nAntigo && nAntigo > nAtual) {
                const perc = Math.round(((nAntigo - nAtual) / nAntigo) * 100);
                msg += `🔥 <b>${perc}% de DESCONTO!</b>\n`;
            }

            msg += `📦 <b>${item.titulo.substring(0, 100)}</b>\n\n`;
            
            if (nAntigo && nAntigo > nAtual) {
                msg += `<s>De: ${item.antigo}</s>\n`;
            }
            
            msg += `💰 <b>Por: ${item.atual}</b>\n\n`;
            msg += `🔗 <a href="${linkAfiliado}">VER NA AMAZON</a>`;

            try {
                if (item.img) {
                    await bot.telegram.sendPhoto(TELEGRAM_CHANNEL_ID, item.img, { caption: msg, parse_mode: "HTML" });
                } else {
                    await bot.telegram.sendMessage(TELEGRAM_CHANNEL_ID, msg, { parse_mode: "HTML" });
                }
                console.log(`✅ Postado: ${item.titulo.substring(0, 20)}`);
                await new Promise(r => setTimeout(r, 60000)); // Espera 1 min
            } catch (e) {
                console.log("❌ Erro no envio Telegram");
            }
        }
    } catch (err) {
        console.error("❌ Erro fatal:", err.message);
    } finally {
        await browser.close();
        console.log("🏁 Ciclo finalizado.");
    }
}

rodarBot();