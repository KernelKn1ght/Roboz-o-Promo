require("dotenv").config();
const { chromium } = require("playwright");
const { Telegraf } = require("telegraf");

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
    console.log(`🚀 Acessando: ${urlSorteada}`);

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
    
    try {
        // Aumentei o tempo de espera e o scroll
        await page.goto(urlSorteada, { waitUntil: "load", timeout: 60000 });
        
        // Scroll simulando humano para disparar o carregamento dos itens
        for (let i = 0; i < 3; i++) {
            await page.evaluate(() => window.scrollBy(0, 800));
            await new Promise(r => setTimeout(r, 2000));
        }

        const ofertas = await page.evaluate(() => {
            const results = [];
            // Seletor mais genérico possível: qualquer link de produto
            const links = document.querySelectorAll('a[href*="/dp/"]');
            
            links.forEach(l => {
                const card = l.closest('div');
                const img = card?.querySelector('img');
                const preco = card?.querySelector('.a-price .a-offscreen')?.innerText;
                const antigo = card?.querySelector('.a-text-price .a-offscreen')?.innerText;
                const titulo = img?.alt || l.innerText;

                if (preco && titulo && titulo.length > 5) {
                    results.push({
                        titulo: titulo.trim(),
                        url: l.href,
                        imagem: img?.src,
                        precoAtual: preco,
                        precoAntigo: antigo
                    });
                }
            });
            return results;
        });

        // Remove duplicatas da mesma raspagem
        const únicas = Array.from(new Map(ofertas.map(item => [item.url.split('?')[1], item])).values());
        console.log(`📦 Itens encontrados: ${únicas.length}`);

        for (const item of únicas.slice(0, 10)) { // Limita a 10 para não floodar
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
                // INTERVALO DE 2 MINUTOS
                await new Promise(r => setTimeout(r, 120000)); 
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