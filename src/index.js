require("dotenv").config();
const { chromium } = require("playwright-extra"); // Use playwright-extra se puder, ou mantenha o chromium
const stealth = require("puppeteer-extra-plugin-stealth")();
const { Telegraf } = require("telegraf");

const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, AMAZON_AFILIADO_TAG } = process.env;

function parsing(texto) {
    if (!texto) return null;
    const n = parseFloat(texto.replace(/[^\d,]/g, "").replace(",", "."));
    return (n && n > 25.0) ? n : null; 
}

async function rodarBot() {
    console.log("🚀 Iniciando Crawler: HARDWARE & SETUP (MODO PRODUÇÃO)...");
    
    // Argumentos específicos para rodar no Linux do GitHub sem ser detectado
    const browser = await chromium.launch({ 
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--window-position=0,0',
            '--ignore-certifcate-errors',
            '--ignore-certifcate-errors-spki-list',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        ]
    }); 

    // Contexto com permissões e geolocalização fake
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        locale: 'pt-BR',
        timezoneId: 'America/Sao_Paulo'
    });

    const page = await context.newPage();

    try {
        // Remove a flag de automação via script injetado
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        console.log("🔍 Acessando Amazon via Headers de Produção...");
        
        // Mudança na URL: Vamos usar uma busca que a Amazon BR não costuma bloquear em datacenter
        const urlHardware = "https://www.amazon.com.br/s?k=ssd+nvme+monitor+gamer+ryzen+-livro&i=computers";
        
        await page.goto(urlHardware, { 
            waitUntil: "networkidle", // Espera a rede acalmar no GitHub
            timeout: 90000 
        });
        
        await page.waitForTimeout(15000); // Tempo para o JS renderizar os preços riscados
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));

        const ofertas = await page.evaluate(() => {
            const results = [];
            const blocos = document.querySelectorAll('.s-result-item[data-asin]');

            blocos.forEach(bloco => {
                const asin = bloco.getAttribute('data-asin');
                if (!asin || asin.length < 5) return;

                const tituloEl = bloco.querySelector('h2');
                const titulo = tituloEl?.innerText || "";

                // Blacklist para garantir que NADA de livro passe
                const lixo = ["livro", "book", "capa comum", "guia", "apostila", "ebook", "kindle"];
                if (lixo.some(termo => titulo.toLowerCase().includes(termo))) return;

                const linkEl = bloco.querySelector('a[href*="/dp/"]');
                const imgEl = bloco.querySelector('img.s-image');

                // Preços (Captura múltipla)
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

        if (ofertas.length === 0) {
            // Debug para produção: tira print se falhar
            await page.screenshot({ path: 'data/debug.png' });
            console.log("📸 Screenshot de erro salva em data/debug.png");
            return;
        }

        const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
        
        for (const item of ofertas.slice(0, 5)) {
            const vAtual = parsing(item.atual);
            const vAntigo = parsing(item.antigo);
            const linkFinal = `${item.url}?tag=${AMAZON_AFILIADO_TAG}`;

            const temDesconto = vAntigo && vAntigo > vAtual;
            let msg = `⚙️ <b>HARDWARE TECH</b> ⚙️\n\n`;

            if (temDesconto) {
                const perc = Math.round(((vAntigo - vAtual) / vAntigo) * 100);
                msg += `🚀 <b>OFERTA: ${perc}% OFF</b>\n`;
            }

            msg += `📦 <b>${item.titulo.substring(0, 85)}...</b>\n\n`;
            
            if (temDesconto) {
                msg += `<s>De: ${item.antigo}</s>\n`;
            }
            msg += `💰 <b>Por: ${item.atual}</b>\n\n`;
            msg += `🔗 <a href="${linkFinal}">LINK DA PEÇA</a>`;

            try {
                if (item.img) await bot.telegram.sendPhoto(TELEGRAM_CHANNEL_ID, item.img, { caption: msg, parse_mode: "HTML" });
                else await bot.telegram.sendMessage(TELEGRAM_CHANNEL_ID, msg, { parse_mode: "HTML" });
                
                await new Promise(r => setTimeout(r, 10000)); 
            } catch (e) { console.log("Erro Telegram"); }
        }
    } finally {
        await browser.close();
        console.log("🏁 Operação Finalizada.");
    }
}

rodarBot();