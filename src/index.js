require("dotenv").config();
const { chromium } = require("playwright-extra"); // Mudamos para o extra
const stealth = require("puppeteer-extra-stealth")();
const { Telegraf } = require("telegraf");

// Adiciona o plugin de furtividade
chromium.use(stealth);

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID,
  AMAZON_AFILIADO_TAG
} = process.env;

const SESSOES_AMAZON = [
    "https://www.amazon.com.br/ofertas", 
    "https://www.amazon.com.br/b?node=16364755011", 
    "https://www.amazon.com.br/b?node=16254446011", 
    "https://www.amazon.com.br/b?node=16209062011"
];

function limparPreco(texto) {
    if (!texto) return null;
    const limpo = texto.replace(/[^\d,\.]/g, "").replace(/\./g, "").replace(",", ".");
    return parseFloat(limpo) || null;
}

function calcularDesconto(original, atual) {
    const v1 = limparPreco(original);
    const v2 = limparPreco(atual);
    if (!v1 || !v2 || v1 <= v2) return null;
    return Math.round(((v1 - v2) / v1) * 100) + "%";
}

function escapeHtml(text) {
    return text ? text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
}

async function rodarBot() {
    const urlSorteada = SESSOES_AMAZON[Math.floor(Math.random() * SESSOES_AMAZON.length)];
    console.log(`🚀 Acessando (Modo Stealth): ${urlSorteada}`);

    const browser = await chromium.launch({ headless: true });
    // Usamos um User Agent de navegador real
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 }
    });
    
    const page = await context.newPage();
    const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
    
    try {
        // Amazon às vezes barra o 'load', vamos tentar 'domcontentloaded'
        await page.goto(urlSorteada, { waitUntil: "domcontentloaded", timeout: 60000 });
        
        // Espera um elemento chave aparecer para confirmar que não caiu no CAPTCHA
        await page.waitForTimeout(7000);

        // Scroll para carregar os cards dinâmicos
        for (let i = 0; i < 4; i++) {
            await page.evaluate(() => window.scrollBy(0, 1000));
            await page.waitForTimeout(2000);
        }

        const ofertas = await page.evaluate(() => {
            const results = [];
            // Seletores que funcionam tanto na home quanto em categorias
            const selectors = [
                'div[data-testid="deal-card"]',
                '.s-result-item',
                '.a-section.dealCard'
            ];
            
            selectors.forEach(sel => {
                document.querySelectorAll(sel).forEach(card => {
                    const link = card.querySelector('a[href*="/dp/"]');
                    const img = card.querySelector('img');
                    const preco = card.querySelector('.a-price .a-offscreen')?.innerText;
                    const antigo = card.querySelector('.a-text-price .a-offscreen')?.innerText;
                    const titulo = img?.alt || card.querySelector('h2')?.innerText;

                    if (link && preco && titulo) {
                        results.push({
                            titulo: titulo.trim(),
                            url: link.href,
                            imagem: img?.src,
                            precoAtual: preco,
                            precoAntigo: antigo
                        });
                    }
                });
            });
            return results;
        });

        const unicas = Array.from(new Map(ofertas.map(item => [item.url.split('?')[0], item])).values());
        console.log(`📦 Itens encontrados: ${unicas.length}`);

        if (unicas.length === 0) {
            // Log do HTML para debug no GitHub Actions se der erro
            const content = await page.content();
            console.log("⚠️ HTML Snippet:", content.substring(0, 500));
        }

        for (const item of unicas.sort(() => Math.random() - 0.5)) {
            const linkFinal = `${item.url.split('?')[0]}?tag=${AMAZON_AFILIADO_TAG}`;
            const desconto = calcularDesconto(item.precoAntigo, item.precoAtual);
            
            let legenda = `🚨 <b>OFERTA ENCONTRADA</b> 🚨\n\n`;
            if (desconto) legenda += `🔥 <b>${desconto} de DESCONTO!</b>\n`;
            legenda += `📦 <b>${escapeHtml(item.titulo.substring(0, 110))}...</b>\n\n`;
            if (item.precoAntigo) legenda += `<s>De: ${item.precoAntigo}</s>\n`;
            legenda += `💰 <b>Por: ${item.precoAtual}</b>\n\n`;
            legenda += `🛒 <a href="${linkFinal}">VER NA AMAZON</a>`;

            try {
                if (item.imagem && item.imagem.startsWith('http')) {
                    await bot.telegram.sendPhoto(TELEGRAM_CHANNEL_ID, item.imagem, { caption: legenda, parse_mode: "HTML" });
                } else {
                    await bot.telegram.sendMessage(TELEGRAM_CHANNEL_ID, legenda, { parse_mode: "HTML" });
                }

                console.log(`✅ Postado: ${item.titulo.substring(0, 20)}`);
                await new Promise(r => setTimeout(r, 120000)); // 2 min
            } catch (e) {
                console.error("❌ Erro envio:", e.message);
            }
        }
    } catch (error) {
        console.error("❌ Erro no Script:", error.message);
    } finally {
        await browser.close();
        console.log("🏁 Ciclo finalizado.");
    }
}

rodarBot();