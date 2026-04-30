require("dotenv").config();
const fs = require("fs");
const path = require("path");
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
const MIN_DISCOUNT_PERCENT = 10;

const SEARCH_URLS = [
    "https://www.amazon.com.br/s?k=pc+gamer+notebook+gamer+placa+de+video&rh=p_n_deal_type%3A23565420011",
    "https://www.amazon.com.br/s?k=celular+smartphone&rh=p_n_deal_type%3A23565420011",
    "https://www.amazon.com.br/s?k=mouse+teclado+monitor+webcam+headset+headphone+mousepad&rh=p_n_deal_type%3A23565420011",
    "https://www.amazon.com.br/s?k=echo+kindle+fire+tv+alexa&rh=p_n_deal_type%3A23565420011"
];
const HISTORICO_PATH = path.join(__dirname, "..", "posted-asins.json");
const MAX_HISTORICO_ASINS = 3000;

function parsing(texto) {
    if (!texto) return null;
    const n = parseFloat(texto.replace(/[^\d,]/g, "").replace(",", "."));
    return (n && n > 30.0) ? n : null; 
}

function carregarHistoricoAsins() {
    try {
        if (!fs.existsSync(HISTORICO_PATH)) return new Set();
        const bruto = fs.readFileSync(HISTORICO_PATH, "utf-8");
        const lista = JSON.parse(bruto);
        if (!Array.isArray(lista)) return new Set();
        return new Set(lista.filter(v => typeof v === "string" && v.length >= 5));
    } catch (e) {
        console.log("⚠️ Falha ao ler histórico de ASINs, iniciando vazio.");
        return new Set();
    }
}

function salvarHistoricoAsins(asinsSet) {
    try {
        const lista = Array.from(asinsSet);
        const listaFinal = lista.length > MAX_HISTORICO_ASINS
            ? lista.slice(lista.length - MAX_HISTORICO_ASINS)
            : lista;
        fs.writeFileSync(HISTORICO_PATH, JSON.stringify(listaFinal, null, 2), "utf-8");
    } catch (e) {
        console.log("⚠️ Falha ao salvar histórico de ASINs.");
    }
}

async function buscarOfertas(page) {
    console.log("🔍 Escaneando ofertas (PC gamer, celulares, periféricos e itens Amazon)...");
    const consolidadas = new Map();

    for (const url of SEARCH_URLS) {
        try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
            await page.waitForTimeout(7000);
            await page.evaluate(() => window.scrollBy(0, 1200));

            const itens = await page.evaluate(() => {
                const results = [];
                const blocos = document.querySelectorAll('.s-result-item[data-asin]');
                const lixo = ["livro", "book", "capa comum", "guia", "apostila", "ebook"];

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

                    const blocoTexto = (bloco.innerText || "").toLowerCase();
                    const freteGratis =
                        blocoTexto.includes("frete grátis") ||
                        blocoTexto.includes("frete gratis") ||
                        blocoTexto.includes("entrega grátis") ||
                        blocoTexto.includes("entrega gratis");

                    if (linkEl && atualEl) {
                        results.push({
                            asin,
                            titulo: titulo.trim(),
                            url: linkEl.href.split("?")[0],
                            atual: atualEl.innerText,
                            antigo: antigoEl ? antigoEl.innerText : null,
                            img: imgEl ? imgEl.src : null,
                            freteGratis
                        });
                    }
                });
                return results;
            });

            for (const item of itens) {
                if (!consolidadas.has(item.asin)) consolidadas.set(item.asin, item);
            }
        } catch (e) {
            console.log(`⚠️ Erro ao carregar busca: ${url}`);
        }
    }

    return Array.from(consolidadas.values());
}

async function rodarBot() {
    const startTime = Date.now();
    const durationLimit = parseInt(ACTIVE_WINDOW_MINUTES) * 60 * 1000;
    
    console.log(`🚀 Iniciando ciclo de ${ACTIVE_WINDOW_MINUTES} minutos.`);
    console.log(`⏱️ Intervalo de postagem: 3.5 minutos.`);
    
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0...', locale: 'pt-BR' });
    const page = await context.newPage();
    const asinsPostados = carregarHistoricoAsins();
    console.log(`🗂️ Histórico carregado: ${asinsPostados.size} ASIN(s).`);

    while (Date.now() - startTime < durationLimit) {
        const ofertas = await buscarOfertas(page);
        
        if (ofertas.length > 0) {
            console.log(`📦 ${ofertas.length} itens encontrados. Iniciando sequência de postagem...`);
            
            for (const item of ofertas) {
                // Verifica se ainda estamos dentro do tempo de 25min antes de postar
                if (Date.now() - startTime >= durationLimit) break;
                if (asinsPostados.has(item.asin)) continue;

                const vAtual = parsing(item.atual);
                const vAntigo = parsing(item.antigo);
                const linkFinal = `${item.url}?tag=${AMAZON_AFILIADO_TAG}`;
                const desconto = (vAtual && vAntigo && vAntigo > vAtual)
                    ? ((vAntigo - vAtual) / vAntigo) * 100
                    : 0;

                if (!vAtual || !vAntigo || desconto <= MIN_DISCOUNT_PERCENT) {
                    continue;
                }

                let msg = `🔥 <b>NOVA OFERTA</b> 🔥\n\n`;
                const tituloCurto = item.titulo.length > 120 ? `${item.titulo.substring(0, 117)}...` : item.titulo;
                msg += `📦 <b>${tituloCurto}</b>\n\n`;
                msg += ` ❌ De: <s>${item.antigo}</s>\n`;
                msg += ` ✅ Por: <b>${item.atual}</b>\n`;
                msg += `Desconto: <b>${desconto.toFixed(0)}%</b>\n`;
                msg += `Frete: <b>${item.freteGratis ? "Gratis" : "Sem frete gratis"}</b>\n\n`;
                msg += `🔗 <a href="${linkFinal}">clique aqui !!!</a>`;

                try {
                    if (item.img) await bot.telegram.sendPhoto(TELEGRAM_CHANNEL_ID, item.img, { caption: msg, parse_mode: "HTML" });
                    else await bot.telegram.sendMessage(TELEGRAM_CHANNEL_ID, msg, { parse_mode: "HTML" });
                    
                    console.log(`✅ Postado: ${item.asin}. Próximo em 3.5 min...`);
                    asinsPostados.add(item.asin);
                    salvarHistoricoAsins(asinsPostados);
                    
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