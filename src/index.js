require("dotenv").config();
const cron = require("node-cron");
const { chromium } = require("playwright");
const { Telegraf, Markup } = require("telegraf");

const AMAZON_OFERTAS_URL = "https://www.amazon.com.br/ofertas";
const AMAZON_INFORMATICA_FALLBACK_URL =
  "https://www.amazon.com.br/s?i=computers&rh=n%3A16364755011%2Cp_n_deal_type%3A23566064011";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const CATEGORY_KEYWORDS = {
  Consoles: [
    "playstation",
    "ps5",
    "ps4",
    "xbox",
    "series s",
    "series x",
    "nintendo switch",
    "console",
    "joy-con",
    "dualsense",
  ],
  "Pecas de Computador": [
    "placa de video",
    "placa mae",
    "processador",
    "memoria ram",
    "ssd",
    "hd ",
    "fonte",
    "cooler",
    "water cooler",
    "gabinete",
    "rtx",
    "geforce",
    "radeon",
  ],
  "Perifericos de Computador": [
    "mouse",
    "teclado",
    "headset",
    "microfone",
    "webcam",
    "monitor",
    "caixa de som",
    "mousepad",
    "hub usb",
    "adaptador usb",
  ],
  "Notebook Gamer": [
    "notebook gamer",
    "laptop gamer",
    "predator",
    "rog strix",
    "legion",
    "tuf gaming",
    "g15",
  ],
  Celular: [
    "celular",
    "smartphone",
    "iphone",
    "samsung galaxy",
    "motorola",
    "xiaomi",
    "redmi",
    "poco",
  ],
};

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID,
  AMAZON_AFILIADO_TAG,
  SCRAPE_INTERVAL_CRON = "*/5 * * * *",
  OFFER_SEND_DELAY_MINUTES = "1",
  MIN_DISCOUNT_PERCENT = "10",
} = process.env;
const OFFER_SEND_DELAY_MS = Number(OFFER_SEND_DELAY_MINUTES) * 60 * 1000;
const MIN_DISCOUNT = Number(MIN_DISCOUNT_PERCENT);
let isJobRunning = false;

function validateEnv() {
  const required = [
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHANNEL_ID",
    "AMAZON_AFILIADO_TAG",
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Variaveis ausentes no .env: ${missing.join(", ")}`);
  }
}

function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toAffiliateUrl(originalUrl, tag) {
  try {
    const url = new URL(originalUrl, "https://www.amazon.com.br");
    url.search = "";
    url.searchParams.set("tag", tag);
    return url.toString();
  } catch (error) {
    console.error("URL invalida ao converter para afiliado:", originalUrl, error);
    return originalUrl;
  }
}

function normalizeText(text) {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isTargetProductTitle(title) {
  const normalized = normalizeText(title);
  return Object.values(CATEGORY_KEYWORDS)
    .flat()
    .some((keyword) => normalized.includes(keyword));
}

function detectCategoryLabel(title) {
  const normalized = normalizeText(title);
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((keyword) => normalized.includes(keyword))) {
      return category;
    }
  }
  return "Geral";
}

function isCommissionEligibleProduct(product) {
  if (!product?.link || !product?.title) return false;

  const normalizedTitle = normalizeText(product.title);
  const normalizedLink = normalizeText(product.link);

  if (!/\/dp\/|\/gp\/product\//i.test(product.link)) return false;
  if (/slredirect|\/sspa\//i.test(normalizedLink)) return false;

  // Regras praticas para evitar itens que normalmente nao geram comissao.
  const blockedKeywords = [
    "gift card",
    "cartao presente",
    "recarga",
    "assinatura",
    "kindle unlimited",
    "audible",
    "prime video",
    "amazon music unlimited",
    "software download",
  ];

  return !blockedKeywords.some((keyword) => normalizedTitle.includes(keyword));
}

function sanitizeAmazonLink(link) {
  if (!link) return null;
  try {
    const url = new URL(link, "https://www.amazon.com.br");
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function cleanProductTitle(rawTitle) {
  if (!rawTitle) return "";
  return rawTitle
    .replace(/\s+/g, " ")
    .replace(/^\d+%?\s*off/i, "")
    .replace(/ofertas?\s*\d+(\.\d+)?/gi, "")
    .replace(/pre[cç]o da oferta:/gi, "")
    .replace(/de:\s*de:/gi, "de:")
    .replace(/R\$\s?\d[\d\.,]*/g, "")
    .replace(/\|?\s*com control…$/i, "")
    .trim();
}

function parsePriceToNumber(priceText) {
  if (!priceText) return null;
  const normalized = priceText
    .replace(/[^\d,\.]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function formatDiscountPercent(discountPercent, originalPrice, currentPrice) {
  if (discountPercent) return discountPercent;
  const original = parsePriceToNumber(originalPrice);
  const current = parsePriceToNumber(currentPrice);
  if (!original || !current || original <= current) return null;
  const pct = Math.round(((original - current) / original) * 100);
  return `${pct}%`;
}

function hasMinimumDiscount(discountPercent, originalPrice, currentPrice) {
  const fromLabel = Number((discountPercent || "").replace(/[^\d]/g, ""));
  if (Number.isFinite(fromLabel) && fromLabel > MIN_DISCOUNT) return true;

  const original = parsePriceToNumber(originalPrice);
  const current = parsePriceToNumber(currentPrice);
  if (!original || !current || original <= current) return false;

  const computedPercent = ((original - current) / original) * 100;
  return computedPercent > MIN_DISCOUNT;
}

function formatShippingLine(hasFreeShipping) {
  if (hasFreeShipping === true) return "🚚 Frete: Gratis";
  if (hasFreeShipping === false) return "🚚 Frete: Nao gratis";
  return "🚚 Frete: Nao informado";
}

async function extractDealsFromPage(page) {
  return page.evaluate(() => {
    const normalizePrice = (value) => {
      if (!value) return null;
      const cleaned = value.replace(/\s+/g, " ").trim();
      return /R\$\s?\d/.test(cleaned) ? cleaned : null;
    };
    const extractPrices = (text) => {
      if (!text) return [];
      const matches = text.match(/R\$\s?\d[\d\.\,]*/g) || [];
      return Array.from(new Set(matches.map((item) => item.trim())));
    };
    const extractDiscount = (text) => {
      if (!text) return null;
      const match = text.match(/(\d{1,2})%\s*off/i);
      return match ? `${match[1]}%` : null;
    };
    const detectFreeShipping = (text) => {
      if (!text) return null;
      if (/frete\s*gr[aá]tis|entrega\s*gr[aá]tis|gr[aá]tis\s*(prime|hoje|amanh[aã])/i.test(text)) {
        return true;
      }
      if (/sem\s*frete\s*gr[aá]tis/i.test(text)) {
        return false;
      }
      return null;
    };
    const parsePriceNumber = (value) => {
      if (!value) return null;
      const normalized = value
        .replace(/[^\d,\.]/g, "")
        .replace(/\./g, "")
        .replace(",", ".");
      const asNumber = Number(normalized);
      return Number.isFinite(asNumber) ? asNumber : null;
    };
    const resolvePricePair = (card, text) => {
      const currentCandidate = normalizePrice(
        card.querySelector(".a-price:not(.a-text-price) .a-offscreen")?.textContent ||
          card.querySelector(".a-price .a-offscreen")?.textContent ||
          ""
      );
      const originalCandidate = normalizePrice(
        card.querySelector(".a-text-price .a-offscreen")?.textContent ||
          card.querySelector('[data-a-strike="true"] .a-offscreen')?.textContent ||
          ""
      );

      let currentPrice = currentCandidate;
      let originalPrice = originalCandidate;

      if (!currentPrice) {
        const extracted = extractPrices(text);
        currentPrice = normalizePrice(extracted[0] || "");
        originalPrice = normalizePrice(extracted[1] || "");
      }

      const currentValue = parsePriceNumber(currentPrice);
      const originalValue = parsePriceNumber(originalPrice);
      if (
        !currentValue ||
        !originalValue ||
        originalValue <= currentValue ||
        currentPrice === originalPrice
      ) {
        originalPrice = null;
      }

      return { currentPrice, originalPrice };
    };

    const dealsMap = new Map();

    const cardSelectors = [
      'div[data-testid="deal-card"]',
      'div[data-cy="deal-card"]',
      '[data-testid*="deal"]',
      "[data-asin]",
      ".s-result-item",
      ".DealGridItem-module__dealItemDisplayGrid_e7RQVFWSOrwXBX4i24Tqg",
    ];

    const allCards = Array.from(
      new Set(cardSelectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))))
    );

    for (const card of allCards) {
      const titleEl =
        card.querySelector("h1, h2, h3, h4") ||
        card.querySelector("img[alt]") ||
        card.querySelector("[title]");
      const title =
        titleEl?.getAttribute("title")?.trim() ||
        titleEl?.getAttribute("alt")?.trim() ||
        titleEl?.textContent?.trim() ||
        null;

      const priceEl =
        card.querySelector(".a-price .a-offscreen") ||
        card.querySelector(".a-color-price") ||
        card.querySelector('[data-a-color="price"]') ||
        card.querySelector('[class*="price"]') ||
        card.querySelector("span");
      const cardText = card.textContent || "";
      const priceText = `${priceEl?.textContent || ""} ${cardText}`.trim();
      const { currentPrice, originalPrice } = resolvePricePair(card, priceText);
      const discountPercent = extractDiscount(cardText);
      const hasFreeShipping = detectFreeShipping(cardText);

      const imageEl = card.querySelector("img");
      const image =
        imageEl?.getAttribute("src") ||
        imageEl?.getAttribute("data-src") ||
        imageEl?.getAttribute("data-a-dynamic-image") ||
        null;

      const linkEl =
        card.querySelector('a[href*="/dp/"]') ||
        card.querySelector('a[href*="/gp/product/"]') ||
        card.querySelector("a[href]");
      const link = linkEl?.getAttribute("href") || null;

      if (title && currentPrice && link) {
        dealsMap.set(`${title}-${link}`, {
          title,
          image,
          link,
          currentPrice,
          originalPrice,
          discountPercent,
          hasFreeShipping,
        });
      }
    }

    // Fallback: varre links de produto em toda a pagina quando os cards mudam de estrutura
    const productLinks = Array.from(
      document.querySelectorAll('a[href*="/dp/"], a[href*="/gp/product/"]')
    ).slice(0, 120);

    for (const anchor of productLinks) {
      const href = anchor.getAttribute("href");
      if (!href) continue;

      const card = anchor.closest("div, li, article, section");
      const title =
        anchor.getAttribute("title")?.trim() ||
        anchor.textContent?.trim() ||
        card?.querySelector("h1, h2, h3, h4")?.textContent?.trim() ||
        card?.querySelector("img[alt]")?.getAttribute("alt")?.trim() ||
        null;

      const textBlock = [
        card?.querySelector(".a-price .a-offscreen")?.textContent || "",
        card?.querySelector(".a-color-price")?.textContent || "",
        card?.textContent || "",
      ].join(" ");
      const { currentPrice, originalPrice } = resolvePricePair(card, textBlock);
      const discountPercent = extractDiscount(textBlock);
      const hasFreeShipping = detectFreeShipping(textBlock);

      const image =
        card?.querySelector("img")?.getAttribute("src") ||
        card?.querySelector("img")?.getAttribute("data-src") ||
        null;

      if (title && currentPrice) {
        dealsMap.set(`${title}-${href}`, {
          title,
          image,
          link: href,
          currentPrice,
          originalPrice,
          discountPercent,
          hasFreeShipping,
        });
      }
    }

    return Array.from(dealsMap.values());
  });
}

async function scrapeInformaticaDeals(limit = 10) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();

  try {
    await page.goto(AMAZON_OFERTAS_URL, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });

    await page.waitForTimeout(2500);

    let deals = await extractDealsFromPage(page);
    if (deals.length === 0) {
      console.warn("Nenhum card util na pagina de ofertas. Tentando URL fallback.");
      await page.goto(AMAZON_INFORMATICA_FALLBACK_URL, {
        waitUntil: "domcontentloaded",
        timeout: 90000,
      });
      await page.waitForTimeout(2500);
      deals = await extractDealsFromPage(page);
    }

    const normalized = deals
      .map((item) => {
        const absoluteLink = sanitizeAmazonLink(item.link);
        const originalValue = parsePriceToNumber(item.originalPrice);
        const currentValue = parsePriceToNumber(item.currentPrice);
        const safeOriginalPrice =
          originalValue && currentValue && originalValue > currentValue
            ? item.originalPrice
            : null;
        return {
          ...item,
          link: absoluteLink,
          title: cleanProductTitle(item.title),
          originalPrice: safeOriginalPrice,
          discountPercent: formatDiscountPercent(
            item.discountPercent,
            safeOriginalPrice,
            item.currentPrice
          ),
        };
      })
      .filter((item) => item.link && item.title && item.currentPrice)
      .filter((item) => isCommissionEligibleProduct(item))
      .filter((item) =>
        hasMinimumDiscount(item.discountPercent, item.originalPrice, item.currentPrice)
      )
      .slice(0, limit);

    return normalized;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function sendDealsToTelegram(bot, deals) {
  if (deals.length === 0) {
    console.log("Nenhuma oferta encontrada para Informatica.");
    return;
  }

  for (const product of deals) {
    const affiliateLink = toAffiliateUrl(product.link, AMAZON_AFILIADO_TAG);
    const categoryLabel = detectCategoryLabel(product.title);
    const discountHeader = product.discountPercent
      ? `🔥 ${escapeHtml(product.discountPercent)} de desconto - ${escapeHtml(categoryLabel)}`
      : `🔥 Oferta - ${escapeHtml(categoryLabel)}`;
    const originalPrice = product.originalPrice || "Nao informado";
    const shippingLine = formatShippingLine(product.hasFreeShipping);
    const caption =
      `🚨 <b>OFERTA RELAMPAGO AMAZON</b> 🚨\n` +
      `${discountHeader}\n` +
      `<b>${escapeHtml(product.title)}</b>\n` +
      `De: ${escapeHtml(originalPrice)}\n` +
      `Por: ${escapeHtml(product.currentPrice)}\n` +
      `${escapeHtml(shippingLine)}\n` +
      `⚡ Aproveite antes que acabe!`;

    try {
      console.log("Link afiliado gerado:", affiliateLink);
      await bot.telegram.sendPhoto(TELEGRAM_CHANNEL_ID, product.image, {
        caption,
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([
          Markup.button.url("Ver Oferta", affiliateLink),
        ]).reply_markup,
      });
      console.log(
        `Aguardando ${OFFER_SEND_DELAY_MINUTES} minuto(s) antes da proxima oferta...`
      );
      await sleep(OFFER_SEND_DELAY_MS);
    } catch (error) {
      console.error("Erro ao enviar produto para Telegram:", product.title, error.message);
    }
  }
}

async function runJob(bot) {
  if (isJobRunning) {
    console.log("Job anterior ainda em execucao. Pulando este ciclo.");
    return;
  }

  isJobRunning = true;
  console.log(`[${new Date().toISOString()}] Iniciando coleta de ofertas...`);
  try {
    const deals = await scrapeInformaticaDeals(10);
    console.log(`Ofertas encontradas: ${deals.length}`);
    await sendDealsToTelegram(bot, deals);
  } catch (error) {
    console.error("Falha na rotina principal:", error);
  } finally {
    isJobRunning = false;
  }
}

async function bootstrap() {
  validateEnv();
  const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

  await runJob(bot);

  cron.schedule(SCRAPE_INTERVAL_CRON, async () => {
    await runJob(bot);
  });

  console.log(`Agendamento ativo com cron: ${SCRAPE_INTERVAL_CRON}`);
}

bootstrap().catch((error) => {
  console.error("Erro ao iniciar bot:", error);
  process.exit(1);
});
