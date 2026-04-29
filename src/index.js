require("dotenv").config();
const { chromium } = require("playwright");
const { Telegraf } = require("telegraf");
const fs = require("fs");
const path = require("path");

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID,
  AMAZON_AFILIADO_TAG
} = process.env;

const STATE_FILE = "data/offers-state.json";

// --- FUNÇÕES DE TRATAMENTO ---
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

// --- CORE ---
async function rodarBot() {
    console.log("🔍 Buscando ofertas...");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
        // Aumentei o timeout e mudei o wait para garantir que o conteúdo apareça
        await page.goto("https://www.amazon.com.br/ofertas", { waitUntil: "load", timeout: 60000 });
        
        // Scroll agressivo para carregar tudo
        await page.evaluate(() => window.scrollBy(0, 2000));
        await new Promise(r => setTimeout(r, 5000)); 

        const ofertas = await page.evaluate(() => {
            const results = [];
            // Seleciona todos os links de produtos que estão dentro de áreas de oferta
            const links = document.querySelectorAll('a[href*="/dp/"], a[href*="/gp/product/"]');
            
            links.forEach(l => {
                const container = l.closest('div[class*="card"]') || l.parentElement;
                const img = container.querySelector('img');
                const pAtual = container.querySelector('.a-price .a-offscreen')?.innerText;
                const pAntigo = container.querySelector('.a-text-price .a-offscreen')?.innerText;
                const txt = img?.alt || container.innerText;

                if (pAtual && txt && l.href) {
                    results.push({
                        titulo: txt.split('\n')[0].trim(),
                        url: l.href,
                        imagem: img?.src,
                        precoAtual: pAtual,
                        precoAntigo: pAntigo
                    });
                }
            });
            return results;
        });

        console.log(`📦 Itens encontrados: ${ofertas.length}`);

        const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
        if (!fs.existsSync("data")) fs.mkdirSync("data");
        const estado = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE)) : { enviado: [] };

        for (const item of ofertas) {
            const asin = item.url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1];
            
            if (asin && !estado.enviado.includes(asin)) {
                // TAG DE AFILIADO
                const linkFinal = `${item.url.split('?')[0]}?tag=${AMAZON_AFILIADO_TAG}`;
                const desconto = calcularDesconto(item.precoAntigo, item.precoAtual);
                
                let legenda = `🚨 <b>OFERTA RELÂMPAGO</b> 🚨\n\n`;
                if (desconto) legenda += `🔥 <b>${desconto} de DESCONTO!</b>\n`;
                legenda += `📦 <b>${escapeHtml(item.titulo.substring(0, 110))}...</b>\n\n`;
                if (item.precoAntigo) legenda += `<s>De: ${item.precoAntigo}</s>\n`;
                legenda += `💰 <b>Por: ${item.precoAtual}</b>\n\n`;
                legenda += `🛒 <a href="${linkFinal}">VER NA AMAZON</a>`;

                try {
                    if (item.imagem) {
                        await bot.telegram.sendPhoto(TELEGRAM_CHANNEL_ID, item.imagem, { caption: legenda, parse_mode: "HTML" });
                    } else {
                        await bot.telegram.sendMessage(TELEGRAM_CHANNEL_ID, legenda, { parse_mode: "HTML" });
                    }

                    console.log(`✅ Postado: ${asin}. Próximo em 5 min...`);
                    estado.enviado.push(asin);
                    fs.writeFileSync(STATE_FILE, JSON.stringify(estado));

                    // INTERVALO DE 2 MINUTOS EXATOS
                    await new Promise(r => setTimeout(r, 120000)); 
                    
                } catch (e) {
                    console.error("❌ Erro envio:", e.message);
                }
            }
        }
    } catch (error) {
        console.error("❌ Erro:", error.message);
    } finally {
        await browser.close();
        console.log("🏁 Ciclo finalizado.");
    }
}

rodarBot().then(() => {
    if (process.env.GITHUB_ACTIONS === "true") process.exit(0);
});