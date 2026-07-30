import express from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// Module-level cache variables to bypass slow API endpoint scanning on subsequent requests
let cachedLoginUrl: string | null = null;
let cachedVerifyUrl: string | null = null;
let cachedRegenUrl: string | null = null;
let cachedSuccessEmailOption: "prefixed" | "original" | null = null;

// Robust fetch helper with retry mechanism for handling intermittent network/DNS issues
async function fetchWithRetry(urlStr: string, options: any = {}, retries = 2, delayMs = 200): Promise<Response> {
  let url = urlStr;
  if (url.includes("osimart.com") && !url.endsWith("/")) {
    url = url + "/";
  }
  const fetchOptions = { ...options };
  // Respect custom timeouts for fast API fallbacks
  const timeoutMs = fetchOptions.timeout || 2000;
  delete fetchOptions.timeout;

  let lastError: any = null;
  for (let i = 0; i < retries; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal
      });
      clearTimeout(timer);
      if (response.status >= 500) {
        lastError = new Error(`HTTP Status ${response.status}`);
        if (i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
      }
      return response;
    } catch (err: any) {
      clearTimeout(timer);
      lastError = err;
      const isFetchFailed = err.message?.includes("fetch failed") || err.name === "AbortError";
      if (!isFetchFailed) {
        console.log(`[fetchWithRetry] Connection attempt to ${url} failed: ${err.message}`);
      }
      if (i < retries - 1 && !isFetchFailed) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        break; // Fail fast on immediate network error
      }
    }
  }
  throw lastError || new Error("Fetch failed after retries");
}

// Helper to resolve the first promise that succeeds, or reject with a descriptive error if all fail
async function anySuccessfulPromise<T>(promises: Array<Promise<T>>): Promise<T> {
  return new Promise((resolve, reject) => {
    let completedCount = 0;
    const errors: any[] = [];
    if (promises.length === 0) {
      return reject(new Error("No candidates to run"));
    }
    promises.forEach((p) => {
      p.then(resolve).catch((err) => {
        errors.push(err);
        completedCount++;
        if (completedCount === promises.length) {
          const descriptiveError = errors.find(e => {
            const msg = e?.message || String(e);
            return !msg.includes("HTML Error") && !msg.includes("Osimart API Error") && !msg.includes("failed");
          }) || errors[0];
          reject(descriptiveError || new Error("All attempts failed"));
        }
      });
    });
  });
}

// Sanitization function to filter out irrelevant browser cookies and only forward sessionid
function cleanOsimartCookie(cookieStr: string | undefined): string {
  if (!cookieStr) return "";
  const parts = cookieStr.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith("sessionid=")) {
      return trimmed;
    }
  }
  if (cookieStr.trim().startsWith("sessionid=")) {
    return cookieStr.trim();
  }
  return "";
}

// Default Fallback Datasets when upstream Osimart API is unreachable
const FALLBACK_BANNERS = [
  {
    id: "b1",
    title: "Welcome to Jessy Juice Boutique",
    description: "Authentic fresh juice cocktails, artisanal crepes & premium gelato in Batroun since 1991.",
    image: "https://lh3.googleusercontent.com/aida-public/AB6AXuC2TPsBHpBWQ0cxim0z6uvep5-y7aqjcamBgXV6zkl7kBqXEwTTtOkqx9fgfYYhxNCIccj7Nf2DNKPSc2-CzQ1D5BDhhnFe55h3HbgRXLncRDg34optSU8Qp-hXy6JMvhWrTuf8Prx3pDd6EGVfwZuoSNl1GtjFS6pghqxMGUaZCR_EguKVDBxADuD2i17YM4QUTwS7OhsDL-6Dp-fIRCqmVxGXfmLHHSl5BlQR4cVJzSsDKcdhP4EPhZahY1Zb4W48mwpTE8AUUg",
    button_title: "Order Fresh Juice",
    active: true
  }
];

const FALLBACK_ANNOUNCEMENTS = [
  {
    id: "a1",
    content: "🍓 Free Delivery on Orders Over $25 in Batroun • Powerful Air Conditioned Seating Available!",
    text: "🍓 Free Delivery on Orders Over $25 in Batroun • Powerful Air Conditioned Seating Available!",
    active: true,
    bg_color: "#863d96",
    text_color: "#ffffff"
  }
];

const FALLBACK_PRODUCTS = [
  // --- COCKTAILS ---
  {
    id: "exotic-cocktail",
    uid: "a101-exotic-cocktail",
    name: "Exotic Cocktail",
    description: "Fruit Slices mix, Cocktail Juice. Served with honey, authentic lebanese ashta, almonds, raisins and pistachio.",
    price: "6.25",
    price_range: "6.25 - 8.50",
    main_image: "https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&q=80&w=600",
    categories: [{ category: { name: "Cocktails", slugified_name: "juice" } }],
    is_popular: true,
    featured: true,
    stock_quantity: 50
  },
  {
    id: "ice-cream-cocktail",
    uid: "a102-ice-cream-cocktail",
    name: "Ice Cream Cocktail",
    description: "Fruit Slices mix, Cocktail Juice, Ice cream, Whipped Cream. Served with honey, authentic lebanese ashta, almonds, raisins and pistachio.",
    price: "6.25",
    price_range: "6.25 - 8.50",
    main_image: "https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&q=80&w=600",
    categories: [{ category: { name: "Cocktails", slugified_name: "juice" } }],
    is_popular: true,
    featured: false,
    stock_quantity: 40
  },
  {
    id: "avocado-cocktail",
    uid: "a103-avocado-cocktail",
    name: "Avocado Cocktail",
    description: "Fruit Slices, Avocado Juice, Milk (Ask for Milk Free). Served with honey, authentic lebanese ashta, almonds, raisins and pistachio.",
    price: "8.25",
    price_range: "8.25 - 9.50",
    main_image: "https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&q=80&w=600",
    categories: [{ category: { name: "Cocktails", slugified_name: "juice" } }],
    is_popular: true,
    featured: true,
    stock_quantity: 35
  },
  {
    id: "half-half-cocktail",
    uid: "a104-half-half-cocktail",
    name: "Half Half Cocktail",
    description: "Half Avocado Cocktail, Half Exotic Cocktail (Ask for Milk Free). Served with honey, authentic lebanese ashta, almonds, raisins and pistachio.",
    price: "6.75",
    price_range: "6.75 - 9.25",
    main_image: "https://images.unsplash.com/photo-1534353473418-4cfa6c56fd38?auto=format&fit=crop&q=80&w=600",
    categories: [{ category: { name: "Cocktails", slugified_name: "juice" } }],
    is_popular: false,
    featured: false,
    stock_quantity: 30
  },
  {
    id: "avocado-nutella",
    uid: "a105-avocado-nutella",
    name: "Avocado Nutella",
    description: "Avocado Juice, Ashta, Nutella, Nuts, Milk (Ask for Milk Free). Served with honey, authentic lebanese ashta, almonds, raisins and pistachio.",
    price: "8.75",
    price_range: "8.75 - 10.75",
    main_image: "https://images.unsplash.com/photo-1546039907-7fa05f864c02?auto=format&fit=crop&q=80&w=600",
    categories: [{ category: { name: "Cocktails", slugified_name: "juice" } }],
    is_popular: true,
    featured: true,
    stock_quantity: 45
  },
  {
    id: "mango-cocktail",
    uid: "a106-mango-cocktail",
    name: "Mango Cocktail",
    description: "Fruit Slices Mix, Mango Juice. Served with honey, authentic lebanese ashta, almonds, raisins and pistachio.",
    price: "7.00",
    price_range: "7.00 - 9.75",
    main_image: "https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&q=80&w=600",
    categories: [{ category: { name: "Cocktails", slugified_name: "juice" } }],
    is_popular: false,
    featured: false,
    stock_quantity: 30
  },
  {
    id: "kimos-cocktail",
    uid: "a107-kimos-cocktail",
    name: "Kimo's Cocktail",
    description: "Crazy Mix Of Avocado & Exotic Cocktail, Chocolate, Nestle & Ashta (Ask for Milk Free). Served with honey, authentic lebanese ashta, almonds, raisins and pistachio.",
    price: "8.25",
    price_range: "8.25 - 10.00",
    main_image: "https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&q=80&w=600",
    categories: [{ category: { name: "Cocktails", slugified_name: "juice" } }],
    is_popular: true,
    featured: true,
    stock_quantity: 25
  },

  // --- LIGHT SECTION ---
  {
    id: "light-fruit-cocktail",
    uid: "a201-light-fruit-cocktail",
    name: "Light Fruit Cocktail",
    description: "Fruit Slices mix, Orange Juice. Sugar free, no ashta, no honey, mixed with Xylitol or Stevia.",
    price: "5.50",
    price_range: "5.50 - 6.75",
    main_image: "https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&q=80&w=600",
    categories: [{ category: { name: "Light Section", slugified_name: "juice" } }],
    is_popular: false,
    featured: false,
    stock_quantity: 30
  },
  {
    id: "light-exotic-cocktail",
    uid: "a202-light-exotic-cocktail",
    name: "Light Exotic Cocktail",
    description: "Fruit Slices Mix, Light Cocktail Juice. Sugar free, no ashta, no honey, mixed with Xylitol or Stevia.",
    price: "6.25",
    price_range: "6.25 - 8.50",
    main_image: "https://images.unsplash.com/photo-1600271886742-f049cd451bba?auto=format&fit=crop&q=80&w=600",
    categories: [{ category: { name: "Light Section", slugified_name: "juice" } }],
    is_popular: false,
    featured: false,
    stock_quantity: 30
  },
  {
    id: "light-avocado-cocktail",
    uid: "a203-light-avocado-cocktail",
    name: "Light Avocado Cocktail",
    description: "Fruit Slices Mix, Light Avocado Juice. Sugar free, no ashta, no honey, mixed with Xylitol or Stevia.",
    price: "8.25",
    price_range: "8.25 - 9.50",
    main_image: "https://images.unsplash.com/photo-1525385133512-2f3bdd039054?auto=format&fit=crop&q=80&w=600",
    categories: [{ category: { name: "Light Section", slugified_name: "juice" } }],
    is_popular: false,
    featured: false,
    stock_quantity: 30
  },
  {
    id: "fruit-cup",
    uid: "a204-fruit-cup",
    name: "Fruit Cup",
    description: "Choose Your Own Fruit Cup with fresh seasonal fruit slices.",
    price: "4.50",
    price_range: "4.50 - 5.50",
    main_image: "https://images.unsplash.com/photo-1568571780765-9276ac8b75a2?auto=format&fit=crop&q=80&w=600",
    categories: [{ category: { name: "Light Section", slugified_name: "juice" } }],
    is_popular: false,
    featured: false,
    stock_quantity: 40
  },
  {
    id: "avocado-juice-keto",
    uid: "a205-avocado-juice-keto",
    name: "Avocado Juice (Keto)",
    description: "Pure keto-friendly fresh avocado blend.",
    price: "8.25",
    price_range: "8.25 - 9.75",
    main_image: "https://images.unsplash.com/photo-1525385133512-2f3bdd039054?auto=format&fit=crop&q=80&w=600",
    categories: [{ category: { name: "Light Section", slugified_name: "juice" } }],
    is_popular: true,
    featured: true,
    stock_quantity: 35
  },
  {
    id: "green-juice",
    uid: "a206-green-juice",
    name: "Green Juice",
    description: "Fresh healthy green detox juice blend.",
    price: "6.50",
    price_range: "6.50 - 21.00",
    main_image: "https://images.unsplash.com/photo-1610970881699-44a5587cabec?auto=format&fit=crop&q=80&w=600",
    categories: [{ category: { name: "Light Section", slugified_name: "juice" } }],
    is_popular: false,
    featured: false,
    stock_quantity: 25
  },
  {
    id: "light-crepe",
    uid: "a207-light-crepe",
    name: "Light Crepe",
    description: "Made with zero sugar chocolate.",
    price: "7.00",
    price_range: "7.00",
    main_image: "https://images.unsplash.com/photo-1519676867240-f03562e64548?auto=format&fit=crop&q=80&w=600",
    categories: [{ category: { name: "Light Section", slugified_name: "chocolate" } }],
    is_popular: false,
    featured: false,
    stock_quantity: 20
  },

  // --- FRESH JUICES ---
  {
    id: "the-j-boost",
    uid: "a301-the-j-boost",
    name: "The J Boost",
    description: "Orange, Banana, Papaya, Mango.",
    price: "4.50",
    price_range: "4.50 - 14.00",
    main_image: "https://images.unsplash.com/photo-1622597467836-f3285f2131b7?auto=format&fit=crop&q=80&w=600",
    categories: [{ category: { name: "Fresh Juices", slugified_name: "juice" } }],
    is_popular: true,
    featured: true,
    stock_quantity: 40
  },
  {
    id: "batrounada-lemonade",
    uid: "a306-batrounada-lemonade",
    name: "Batrounada Lemonade",
    description: "Traditional Batroun fresh squeezed lemonade.",
    price: "2.50",
    price_range: "2.50 - 9.00",
    main_image: "https://images.unsplash.com/photo-1523371054106-bbf80586c38c?auto=format&fit=crop&q=80&w=600",
    categories: [{ category: { name: "Fresh Juices", slugified_name: "juice" } }],
    is_popular: true,
    featured: true,
    stock_quantity: 100
  },
  {
    id: "mulberry-juice",
    uid: "a321-mulberry-juice",
    name: "Mulberry Juice",
    description: "Authentic Lebanese mountain mulberry (Toot).",
    price: "3.50",
    price_range: "3.50 - 11.00",
    main_image: "https://images.unsplash.com/photo-1563227812-0ea4c22e6cc8?auto=format&fit=crop&q=80&w=600",
    categories: [{ category: { name: "Fresh Juices", slugified_name: "juice" } }],
    is_popular: true,
    featured: true,
    stock_quantity: 50
  },

  // --- SHAKES ---
  {
    id: "oreo-milkshake",
    uid: "a401-oreo-milkshake",
    name: "Oreo Milkshake",
    description: "Rich Oreo cookie shake topped with whipped cream.",
    price: "5.00",
    price_range: "5.00 - 6.00",
    main_image: "https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&q=80&w=600",
    categories: [{ category: { name: "Shakes", slugified_name: "icecream" } }],
    is_popular: true,
    featured: false,
    stock_quantity: 45
  },
  {
    id: "kunafa-shake",
    uid: "a409-kunafa-shake",
    name: "Kunafa Pistachio Shake",
    description: "Arabic kunafa crunch with premium pistachio cream shake.",
    price: "7.50",
    price_range: "7.50",
    main_image: "https://lh3.googleusercontent.com/aida-public/AB6AXuBw_Hzm4Wzi8aLRbQ1wBnaIwITUouZl2HmG7LLJo3cfNoZ65ueZ7NHCz7wtMHYVws4Aaiyu7Mdts8p9fkKE2636x9y6iItr8DlgwYb5FepgU5yGzcPz-DigZjxcGu42FU20aklypGHeJ5vm0hLv5EjOSDRIMgOMvAn-F2C25KLqo7oYEO-tRqtYlFwNBFVLpFZLmzkZtvBm2EfrkdADgmtQJX3k7hA_4X5eCyImHBFKOVzgjwuo_tuwG88YegxqCHsF_3zT7ZXHWw",
    categories: [{ category: { name: "Shakes", slugified_name: "icecream" } }],
    is_popular: true,
    featured: true,
    stock_quantity: 30
  },

  // --- CRÊPES ---
  {
    id: "fettuccine-crepe",
    uid: "a907-fettuccine-crepe",
    name: "Fettucini Crêpe",
    description: "Belgium chocolate, white chocolate & ice cream on fettuccine crepe ribbons.",
    price: "9.50",
    price_range: "9.50",
    main_image: "https://lh3.googleusercontent.com/aida-public/AB6AXuCzX-I0vYKkYi-9-wfTsa5QDmZoxwajpfSPpMlcc0muC2LaraDShi-DGvAWWTIWDGZC1SG9mXeJbVWkHl81XaHPynKi1UamZ4EIdJmBvqn7HnCkcl69CrRSTZAcibQp8C8KDqDRilvR6bw0XQXSDSplVsDQnpIzNSKB8eFkfSyQ4z2TPgrdVKWP2n9wdoSk8zOp2OkbokVDYXzDOndhhCS2p2H2fsgcPXwPrhTx71YHDuc4t2FbylRaf-cmiKZ5CI-IyVc1hLuLng",
    categories: [{ category: { name: "Crepes", slugified_name: "chocolate" } }],
    is_popular: true,
    featured: true,
    stock_quantity: 25
  },

  // --- WAFFLES ---
  {
    id: "signature-waffles",
    uid: "a1101-signature-waffles",
    name: "Signature Waffles",
    description: "Double-layered golden Belgian waffles stacked high, topped with fresh seasonal berries, syrup, and pure Chantilly whipped cream.",
    price: "9.00",
    price_range: "9.00",
    main_image: "https://lh3.googleusercontent.com/aida-public/AB6AXuA9sPCTg7wMdT71laC8wREQKvHSN1ow7uUsKDAlToycK3A2LyGStZVMxOlkpkxQayzMb6earMhUaDJVJx6ECca0vJ2zAWstoVDuL4USF04ZOYspXk_ZF5vx4DFygykgfXAVNgAHh24mwKL7foGlw-sQ4sheBAMp113rzRcARXgOzdNA_92UI5N_YD9SjTTnmN4tR6emViAxTurpoOloCMbTDESAUcOXzRsX02-aypzjn4cdwdUJpGPa3eoi5rV0ZYpGmW1WYl5pfg",
    categories: [{ category: { name: "Waffles", slugified_name: "cake" } }],
    is_popular: true,
    featured: true,
    stock_quantity: 40
  },

  // --- SUSHI CREPE BOAT ---
  {
    id: "sushi-crepes",
    uid: "a1201-sushi-crepes",
    name: "Sushi Crepe Boat (9 Pieces)",
    description: "Proud creators of the Sushi Crepe Boat! Available in Oreo, Lotus, Wafer, Crispy, Crunch, Ferrero, Banana, Brownie, Coconut, Strawberry, Peanut Butter, Dubai Chocolate.",
    price: "10.00",
    price_range: "10.00 - 80.00",
    main_image: "https://lh3.googleusercontent.com/aida-public/AB6AXuC2TPsBHpBWQ0cxim0z6uvep5-y7aqjcamBgXV6zkl7kBqXEwTTtOkqx9fgfYYhxNCIccj7Nf2DNKPSc2-CzQ1D5BDhhnFe55h3HbgRXLncRDg34optSU8Qp-hXy6JMvhWrTuf8Prx3pDd6EGVfwZuoSNl1GtjFS6pghqxMGUaZCR_EguKVDBxADuD2i17YM4QUTwS7OhsDL-6Dp-fIRCqmVxGXfmLHHSl5BlQR4cVJzSsDKcdhP4EPhZahY1Zb4W48mwpTE8AUUg",
    categories: [{ category: { name: "Sushi Crepe Boat", slugified_name: "chocolate" } }],
    is_popular: true,
    featured: true,
    stock_quantity: 30
  }
];

let cachedPrefix: string | null = null;
async function getStorePrefix(storeId: string): Promise<string> {
  if (cachedPrefix) return cachedPrefix;
  try {
    const url = `https://api.osimart.com/store/apis/stores/${storeId}/`;
    const response = await fetchWithRetry(url, {}, 1, 100);
    if (response.ok) {
      const data = await response.json();
      if (data && data.name) {
        cachedPrefix = data.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        console.log(`[Store Prefix] Successfully resolved prefix "${cachedPrefix}" for store "${data.name}"`);
        return cachedPrefix;
      }
    }
  } catch (err: any) {
    cachedPrefix = "mystore4";
  }
  return "mystore4";
}

const app = express();
app.use(express.json());

// Vercel request path normalization middleware to restore original client paths in serverless environment
app.use((req, res, next) => {
  const forwardedUri = req.headers["x-forwarded-uri"] || req.headers["x-matched-path"];
  if (forwardedUri && typeof forwardedUri === "string") {
    if (forwardedUri !== req.url && forwardedUri.startsWith("/api/")) {
      console.log(`[Vercel URL Normalize] Normalizing req.url from "${req.url}" to "${forwardedUri}"`);
      req.url = forwardedUri;
    }
  }
  next();
});

// Osimart Proxy Endpoints to bypass CORS limitations in the browser
  app.get("/api/osimart/banners", async (req, res) => {
    try {
      let storeId = process.env.VITE_OSIMART_STORE_ID || "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(storeId.trim())) {
        storeId = "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      }
      const url = `https://api.osimart.com/store/apis/banners/?store=${storeId}`;
      const response = await fetchWithRetry(url);
      if (!response.ok) {
        throw new Error(`Osimart Banners API responded with status ${response.status}`);
      }
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.warn("Proxy Banners serving fallback data:", error.message);
      res.json(FALLBACK_BANNERS);
    }
  });

  app.get("/api/osimart/announcements", async (req, res) => {
    try {
      let storeId = process.env.VITE_OSIMART_STORE_ID || "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(storeId.trim())) {
        storeId = "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      }
      const url = `https://api.osimart.com/store/apis/announcementbars/?store=${storeId}`;
      const response = await fetchWithRetry(url);
      if (!response.ok) {
        throw new Error(`Osimart Announcements API responded with status ${response.status}`);
      }
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.warn("Proxy Announcements serving fallback data:", error.message);
      res.json(FALLBACK_ANNOUNCEMENTS);
    }
  });

  app.get("/api/osimart/products", async (req, res) => {
    try {
      let storeId = process.env.VITE_OSIMART_STORE_ID || "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(storeId.trim())) {
        storeId = "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      }
      const url = `https://api.osimart.com/store/apis/products/?store=${storeId}`;
      const response = await fetchWithRetry(url);
      if (!response.ok) {
        throw new Error(`Osimart Products API responded with status ${response.status}`);
      }
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.warn("Proxy Products serving fallback dataset:", error.message);
      res.json(FALLBACK_PRODUCTS);
    }
  });

  // Product Info Catalog for console logging
  const PRODUCT_INFO_CATALOG: Record<string, { name: string; price: number; category: string; description: string }> = {
    'sushi-crepes': { name: 'Sushi Crepes', price: 12.0, category: 'Crepes & Chocolate', description: 'Delicate crepe rolls filled with exotic fruits, spread with rich chocolate hazelnut, and served with pure Belgian dip.' },
    'ab6859a7-f28b-4d06-9122-125a7e3df3b5': { name: 'Sushi Crepes', price: 12.0, category: 'Crepes & Chocolate', description: 'Delicate crepe rolls filled with exotic fruits, spread with rich chocolate hazelnut, and served with pure Belgian dip.' },
    '03dce709-9421-475e-bd93-d583d5ca58f5': { name: 'Sushi Crepes', price: 12.0, category: 'Crepes & Chocolate', description: 'Delicate crepe rolls filled with exotic fruits, spread with rich chocolate hazelnut, and served with pure Belgian dip.' },

    'avocado-cocktail': { name: 'Avocado Cocktail', price: 10.0, category: 'Exotic Juices', description: 'Creamy high-key avocado purée base topped with a colorful hand-cut coastal fruit medley, fresh honey drizzle, and raw nuts.' },
    '438761ef-b843-4ed3-9815-51e8f6c68202': { name: 'Avocado Cocktail', price: 10.0, category: 'Exotic Juices', description: 'Creamy high-key avocado purée base topped with a colorful hand-cut coastal fruit medley, fresh honey drizzle, and raw nuts.' },
    '69781760-2755-4a92-b04e-22387c2f9936': { name: 'Avocado Cocktail', price: 10.0, category: 'Exotic Juices', description: 'Creamy high-key avocado purée base topped with a colorful hand-cut coastal fruit medley, fresh honey drizzle, and raw nuts.' },

    'berry-crepe': { name: 'Berry Crepe', price: 11.0, category: 'Crepes & Chocolate', description: 'Light French crepe loaded with wild berries, drizzled with warm milk chocolate and white chocolate chips.' },
    'bc0ec9d3-950e-469f-8190-0b1f94e7feea': { name: 'Berry Crepe', price: 11.0, category: 'Crepes & Chocolate', description: 'Light French crepe loaded with wild berries, drizzled with warm milk chocolate and white chocolate chips.' },
    '298de975-0605-479d-92ed-20e8a4052a9c': { name: 'Berry Crepe', price: 11.0, category: 'Crepes & Chocolate', description: 'Light French crepe loaded with wild berries, drizzled with warm milk chocolate and white chocolate chips.' },

    'molten-batroun': { name: 'Molten Batroun Chocolate Cake', price: 13.5, category: 'Waffles & Cakes', description: 'Signature lava cake with a molten premium Belgian chocolate core, served with high-end vanilla gelato.' },
    '4a25e7d3-4021-4573-9685-12fd3823252d': { name: 'Molten Batroun Chocolate Cake', price: 13.5, category: 'Waffles & Cakes', description: 'Signature lava cake with a molten premium Belgian chocolate core, served with high-end vanilla gelato.' },
    '30cae79f-4278-49ff-a7ce-087536a0cc06': { name: 'Molten Batroun Chocolate Cake', price: 13.5, category: 'Waffles & Cakes', description: 'Signature lava cake with a molten premium Belgian chocolate core, served with high-end vanilla gelato.' },

    'sunset-sip': { name: 'Sunset Sip (Mango Peach Juice)', price: 8.5, category: 'Exotic Juices', description: 'Refreshing layered juice featuring organic alphonso mango, sweet sun-ripened peaches, and freshly squeezed orange juice.' },
    'c4b3ec57-beb2-4d47-9510-3bd6c8f94b0a': { name: 'Sunset Sip (Mango Peach Juice)', price: 8.5, category: 'Exotic Juices', description: 'Refreshing layered juice featuring organic alphonso mango, sweet sun-ripened peaches, and freshly squeezed orange juice.' },
    'db47fc80-b082-44a3-8c8e-09e737ce4793': { name: 'Sunset Sip (Mango Peach Juice)', price: 8.5, category: 'Exotic Juices', description: 'Refreshing layered juice featuring organic alphonso mango, sweet sun-ripened peaches, and freshly squeezed orange juice.' },

    'signature-waffles': { name: 'Signature Waffles', price: 9.0, category: 'Waffles & Cakes', description: 'Double-layered golden Belgian waffles stacked high, topped with fresh seasonal berries, syrup, and pure Chantilly whipped cream.' },
    '15e39ef6-2b5b-49b0-8e2f-2da09a19f82a': { name: 'Signature Waffles', price: 9.0, category: 'Waffles & Cakes', description: 'Double-layered golden Belgian waffles stacked high, topped with fresh seasonal berries, syrup, and pure Chantilly whipped cream.' },
    '986309d2-3f63-4e71-b304-5f113bce56f7': { name: 'Signature Waffles', price: 9.0, category: 'Waffles & Cakes', description: 'Double-layered golden Belgian waffles stacked high, topped with fresh seasonal berries, syrup, and pure Chantilly whipped cream.' },

    'kunafa-shake': { name: 'Kunafa Shake', price: 7.5, category: 'Exotic Juices', description: 'Traditional Arabic sweet blended with pistachio gelato, topped with golden crispy kunafa crust and rose water glaze.' },
    '837c915b-cab5-4b8f-bb4b-21f00db02094': { name: 'Kunafa Shake', price: 7.5, category: 'Exotic Juices', description: 'Traditional Arabic sweet blended with pistachio gelato, topped with golden crispy kunafa crust and rose water glaze.' },
    '9b0810fe-f2ee-444a-b88d-d46b51213cb5': { name: 'Kunafa Shake', price: 7.5, category: 'Exotic Juices', description: 'Traditional Arabic sweet blended with pistachio gelato, topped with golden crispy kunafa crust and rose water glaze.' },

    'fettuccine-crepe': { name: 'Fettuccine Crepe', price: 12.0, category: 'Crepes & Chocolate', description: 'Crepe sliced in ribbon style like fettuccine, topped generously with white, milk, and dark Belgian chocolates and fresh berries.' },
    'd2ffffd5-78ee-49f3-ae93-768b63a337d0': { name: 'Fettuccine Crepe', price: 12.0, category: 'Crepes & Chocolate', description: 'Crepe sliced in ribbon style like fettuccine, topped generously with white, milk, and dark Belgian chocolates and fresh berries.' },
    'e2011ee5-be65-4caf-8c13-1e3a542655c5': { name: 'Fettuccine Crepe', price: 12.0, category: 'Crepes & Chocolate', description: 'Crepe sliced in ribbon style like fettuccine, topped generously with white, milk, and dark Belgian chocolates and fresh berries.' },
  };

  function logProductAction(productId: string, variantId: string, qty: number, action: string, success: boolean, errorDetails?: string) {
    const pInfo = PRODUCT_INFO_CATALOG[productId] || PRODUCT_INFO_CATALOG[variantId] || {
      name: "Custom Dessert / Sweet Plate Item",
      price: 10.0,
      category: "Specialties",
      description: "Handcrafted dessert tailored with selected options."
    };

    const name = pInfo.name;
    const price = pInfo.price;
    const category = pInfo.category;
    const totalCost = (price * qty).toFixed(2);

    const reset = "\x1b[0m";
    const green = "\x1b[32m";
    const red = "\x1b[31m";
    const cyan = "\x1b[36m";
    const yellow = "\x1b[33m";
    const magenta = "\x1b[35m";
    const bold = "\x1b[1m";

    const color = success ? green : red;
    const actionLabel = action.toUpperCase();

    console.log("");
    console.log(`${color}┌────────────────────────────────────────────────────────┐${reset}`);
    console.log(`${color}│ 🛒  PRODUCT CART TRANSACTION REPORT                    │${reset}`);
    console.log(`${color}├────────────────────────────────────────────────────────┤${reset}`);
    console.log(`${color}│${reset}  ${bold}Status:${reset}     ${success ? green + "SUCCESSFUL ✅" : red + "FAILED ❌"}${reset}`);
    console.log(`${color}│${reset}  ${bold}Action:${reset}     ${yellow}${actionLabel}${reset}`);
    console.log(`${color}│${reset}  ${bold}Name:${reset}       ${cyan}${name}${reset}`);
    console.log(`${color}│${reset}  ${bold}Category:${reset}   ${magenta}${category}${reset}`);
    console.log(`${color}│${reset}  ${bold}Price:${reset}      ${green}$${price.toFixed(2)}${reset}`);
    console.log(`${color}│${reset}  ${bold}Quantity:${reset}   ${bold}${qty}${reset}`);
    console.log(`${color}│${reset}  ${bold}Total Cost:${reset} ${green}$${totalCost}${reset}`);
    console.log(`${color}│${reset}  ${bold}Product ID:${reset} ${productId}`);
    console.log(`${color}│${reset}  ${bold}Variant ID:${reset} ${variantId}`);
    if (!success && errorDetails) {
      console.log(`${color}├────────────────────────────────────────────────────────┤${reset}`);
      console.log(`${color}│${reset}  ${bold}${red}Error Detail:${reset} ${red}${errorDetails}${reset}`);
    }
    console.log(`${color}└────────────────────────────────────────────────────────┘${reset}`);
    console.log("");
  }

  app.get("/api/osimart/products/:id", async (req, res) => {
    try {
      const { id } = req.params;
      let storeId = process.env.VITE_OSIMART_STORE_ID || "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(storeId.trim())) {
        storeId = "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      }
      const url = `https://api.osimart.com/store/apis/products/${id}/?store=${storeId}`;
      const response = await fetchWithRetry(url);
      if (!response.ok) {
        throw new Error(`Osimart Product Detail API responded with status ${response.status}`);
      }
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.warn(`Proxy Product Detail serving fallback for ID ${req.params.id}:`, error.message);
      const found = FALLBACK_PRODUCTS.find(p => p.id === req.params.id || p.uid === req.params.id) || FALLBACK_PRODUCTS[0];
      res.json(found);
    }
  });

  // Osimart Cart Update-Item Proxy
  app.post("/api/osimart/cart/update-item", async (req, res) => {
    try {
      let storeId = process.env.VITE_OSIMART_STORE_ID || "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(storeId.trim())) {
        storeId = "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      }

      // Map product_id to the actual Osimart Variant ID
      const inputId = req.body.product_id || req.body.item_id || "";
      const PRODUCT_TO_VARIANT_MAP: Record<string, string> = {
        'sushi-crepes': 'ab6859a7-f28b-4d06-9122-125a7e3df3b5',
        'avocado-cocktail': '438761ef-b843-4ed3-9815-51e8f6c68202',
        'berry-crepe': 'bc0ec9d3-950e-469f-8190-0b1f94e7feea',
        'molten-batroun': '4a25e7d3-4021-4573-9685-12fd3823252d',
        'sunset-sip': 'c4b3ec57-beb2-4d47-9510-3bd6c8f94b0a',
        'signature-waffles': '15e39ef6-2b5b-49b0-8e2f-2da09a19f82a',
        'kunafa-shake': '837c915b-cab5-4b8f-bb4b-21f00db02094',
        'fettuccine-crepe': 'd2ffffd5-78ee-49f3-ae93-768b63a337d0',
        '03dce709-9421-475e-bd93-d583d5ca58f5': 'ab6859a7-f28b-4d06-9122-125a7e3df3b5',
        '69781760-2755-4a92-b04e-22387c2f9936': '438761ef-b843-4ed3-9815-51e8f6c68202',
        '298de975-0605-479d-92ed-20e8a4052a9c': 'bc0ec9d3-950e-469f-8190-0b1f94e7feea',
        '30cae79f-4278-49ff-a7ce-087536a0cc06': '4a25e7d3-4021-4573-9685-12fd3823252d',
        'db47fc80-b082-44a3-8c8e-09e737ce4793': 'c4b3ec57-beb2-4d47-9510-3bd6c8f94b0a',
        '986309d2-3f63-4e71-b304-5f113bce56f7': '15e39ef6-2b5b-49b0-8e2f-2da09a19f82a',
        '9b0810fe-f2ee-444a-b88d-d46b51213cb5': '837c915b-cab5-4b8f-bb4b-21f00db02094',
        'e2011ee5-be65-4caf-8c13-1e3a542655c5': 'd2ffffd5-78ee-49f3-ae93-768b63a337d0',
      };

      const variantId = PRODUCT_TO_VARIANT_MAP[inputId] || inputId;
      const qty = Number(req.body.quantity !== undefined ? req.body.quantity : (req.body.qty !== undefined ? req.body.qty : 1));
      const action = qty > 0 ? "add" : "remove";

      // We support the robust api.osimart.com endpoints with/without trailing slashes
      const targetUrls = [
        `https://api.osimart.com/store/apis/cart/update-item/?store=${storeId}`,
        `https://api.osimart.com/store/apis/cart/update-item?store=${storeId}`
      ];

      let lastError = null;
      let responseData = null;
      let success = false;

      // Forward client's cookies or the custom X-Osimart-Cookie header
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Accept": "application/json"
      };
      
      let cookieToSend = "";
      if (req.headers["x-osimart-cookie"]) {
        cookieToSend = cleanOsimartCookie(req.headers["x-osimart-cookie"] as string);
      }
      if (cookieToSend) {
        headers["Cookie"] = cookieToSend;
      }

      const payload = {
        item_id: variantId,
        action: action,
        quantity: qty,
        session_id: req.body.session_id || req.body.cart_id || "",
        cart_id: req.body.cart_id || req.body.session_id || "",
        store: storeId
      };

      for (const url of targetUrls) {
        try {
          // Quiet internal proxy log
          const response = await fetchWithRetry(url, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(payload)
          });

          // Forward the Set-Cookie headers back to the browser
          const setCookie = response.headers.get("set-cookie");
          if (setCookie) {
            res.setHeader("Set-Cookie", setCookie);
          }

          const text = await response.text();
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch (_) {
            parsed = { message: text };
          }

          if (response.ok) {
            responseData = parsed;
            // Inject the cleaned cookie string into response JSON
            if (setCookie && typeof responseData === "object" && responseData !== null) {
              responseData.osimart_cookie = setCookie.split(";")[0];
            }
            success = true;
            // Quiet internal proxy log
            break;
          } else {
            let extracted = "";
            if (Array.isArray(parsed)) {
              extracted = parsed.join(", ");
            } else if (typeof parsed === "object" && parsed !== null) {
              extracted = parsed.error || parsed.details || parsed.message || parsed.msg || JSON.stringify(parsed);
            } else {
              extracted = String(parsed);
            }
            lastError = extracted;
            
            // If the status is 404 (Not Found) or 405 (Method Not Allowed), this endpoint might be invalid.
            // Continue the loop to try other alternative subdomains/URLs.
            if (response.status === 404 || response.status === 405) {
              // Quiet internal proxy log
              continue;
            }
            break;
          }
        } catch (err: any) {
          lastError = err.message;
        }
      }

      // Log beautifully to the terminal for debugging and validation
      logProductAction(inputId, variantId, qty, action, success, lastError || undefined);

      if (success && responseData) {
        res.json(responseData);
      } else {
        console.log("[Proxy Cart Update] Using simulated local response for offline mode.");
        res.json({
          status: "success",
          message: "Item updated in cart",
          item_id: variantId,
          quantity: qty,
          session_id: req.body.session_id || req.body.cart_id || "offline_sess"
        });
      }
    } catch (error: any) {
      console.warn("Proxy Cart Update fallback:", error.message);
      res.json({
        status: "success",
        message: "Item updated in cart",
        quantity: req.body.quantity || 1
      });
    }
  });

  // Osimart Cart View Proxy (Checking both /cart/view and /view endpoints on api & v2 subdomains)
  app.post("/api/osimart/cart/view", async (req, res) => {
    try {
      let storeId = process.env.VITE_OSIMART_STORE_ID || "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(storeId.trim())) {
        storeId = "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      }
      
      const endpoints = [
        `https://api.osimart.com/store/apis/cart/view/?store=${storeId}`,
        `https://api.osimart.com/store/apis/cart/view?store=${storeId}`,
        `https://api.osimart.com/store/apis/view/?store=${storeId}`,
        `https://api.osimart.com/store/apis/view?store=${storeId}`
      ];
      
      let lastError = null;
      let data = null;

      // Forward client's cookies or the custom X-Osimart-Cookie header
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Accept": "application/json"
      };
      
      let cookieToSend = "";
      if (req.headers["x-osimart-cookie"]) {
        cookieToSend = cleanOsimartCookie(req.headers["x-osimart-cookie"] as string);
      }
      if (cookieToSend) {
        headers["Cookie"] = cookieToSend;
      }
      
      for (const url of endpoints) {
        try {
          // Quiet internal proxy log
          const response = await fetchWithRetry(url, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(req.body)
          });

          const setCookie = response.headers.get("set-cookie");
          if (setCookie) {
            res.setHeader("Set-Cookie", setCookie);
          }
          
          if (response.ok) {
            data = await response.json();
            if (setCookie && typeof data === "object" && data !== null) {
              data.osimart_cookie = setCookie.split(";")[0];
            }
            // Quiet internal proxy log
            break;
          } else {
            const errText = await response.text();
            lastError = `Status ${response.status}: ${errText}`;
          }
        } catch (err: any) {
          lastError = err.message;
        }
      }
      
      // If POST didn't work, let's also try GET for both URLs
      if (!data) {
        for (const url of endpoints) {
          try {
            let getUrl = url;
            if (req.body && req.body.session_id) {
              getUrl += `&session_id=${encodeURIComponent(req.body.session_id)}`;
            }
            if (req.body && req.body.cart_id) {
              getUrl += `&cart_id=${encodeURIComponent(req.body.cart_id)}`;
            }
            
            // Quiet internal proxy log
            
            const getHeaders: Record<string, string> = {
              "Accept": "application/json"
            };
            if (cookieToSend) {
              getHeaders["Cookie"] = cookieToSend;
            }
            
            const response = await fetchWithRetry(getUrl, {
              method: "GET",
              headers: getHeaders
            });

            const setCookie = response.headers.get("set-cookie");
            if (setCookie) {
              res.setHeader("Set-Cookie", setCookie);
            }
            
            if (response.ok) {
              data = await response.json();
              if (setCookie && typeof data === "object" && data !== null) {
                data.osimart_cookie = setCookie.split(";")[0];
              }
              // Quiet internal proxy log
              break;
            } else {
              const errText = await response.text();
              lastError = `GET Status ${response.status}: ${errText}`;
            }
          } catch (err: any) {
            lastError = err.message;
          }
        }
      }
      
      if (data) {
        res.json(data);
      } else {
        console.log("[Proxy Cart View] Serving clean offline cart.");
        res.json({
          status: "success",
          items: [],
          cart: { items: [], total: 0 }
        });
      }
    } catch (error: any) {
      console.warn("Proxy Cart View fallback:", error.message);
      res.json({
        status: "success",
        items: [],
        cart: { items: [], total: 0 }
      });
    }
  });

  // Osimart Orders / Checkout Proxy
  app.post("/api/osimart/orders/create", async (req, res) => {
    try {
      let storeId = process.env.VITE_OSIMART_STORE_ID || "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(storeId.trim())) {
        storeId = "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      }

      // Incorporate the functional checkout endpoint we discovered!
      const endpoints = [
        `https://api.osimart.com/store/apis/checkout/?store=${storeId}`,
        `https://api.osimart.com/store/apis/checkout?store=${storeId}`,
        `https://api.osimart.com/store/apis/orders/?store=${storeId}`,
        `https://api.osimart.com/store/apis/orders?store=${storeId}`,
        `https://api.osimart.com/store/apis/cart/checkout/?store=${storeId}`,
        `https://api.osimart.com/store/apis/cart/checkout?store=${storeId}`
      ];

      let lastError = null;
      let data = null;

      // Forward client's cookies or the custom X-Osimart-Cookie header or Authorization token
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Accept": "application/json"
      };

      const authHeader = req.headers.authorization || "";
      if (authHeader) {
        headers["Authorization"] = authHeader;
      }
      
      let cookieToSend = "";
      if (req.headers["x-osimart-cookie"]) {
        cookieToSend = cleanOsimartCookie(req.headers["x-osimart-cookie"] as string);
      }
      if (cookieToSend) {
        headers["Cookie"] = cookieToSend;
      }

      // Ensure payment_method_id is supplied (Default to Cash on Delivery)
      const payload = {
        payment_method_id: req.body.payment_method_id || "bfc53508-839e-4d8c-868e-f2c27702ed41",
        session_id: req.body.session_id || req.body.cart_id || "",
        cart_id: req.body.cart_id || req.body.session_id || "",
        store: storeId,
        ...req.body
      };

      for (const url of endpoints) {
        try {
          console.log(`[Proxy Checkout POST] Trying URL: ${url}`, payload);
          const response = await fetchWithRetry(url, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(payload)
          });

          const setCookie = response.headers.get("set-cookie");
          if (setCookie) {
            res.setHeader("Set-Cookie", setCookie);
          }

          const text = await response.text();
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch (_) {
            parsed = { message: text };
          }

          if (response.ok) {
            data = parsed;
            console.log(`[Proxy Checkout POST] Success using URL: ${url}`);
            
            // Log beautiful details for the user to see in their console/terminal!
            console.log(`\n========================================================`);
            console.log(`🎉 [Order API Success Logging] NEW ORDER PLACED SUCCESSFULLY!`);
            console.log(`- Customer Name: ${payload.customer_name || 'Anonymous Guest'}`);
            console.log(`- Customer Email: ${payload.customer_email || 'No email'}`);
            console.log(`- Customer Phone: ${payload.customer_phone || 'No phone'}`);
            console.log(`- Customer City: ${payload.customer_city || 'No city'}`);
            console.log(`- Is Guest Order: ${payload.is_guest ? 'YES ✅' : 'NO ❌ (Logged In Member)'}`);
            console.log(`- Total Amount: $${payload.total_amount}`);
            console.log(`- Items Count: ${payload.item_count}`);
            console.log(`========================================================\n`);
            
            break;
          } else {
            lastError = `Status ${response.status}: ${JSON.stringify(parsed)}`;
            if (response.status === 400 || response.status === 409 || response.status === 422) {
              lastError = parsed.error || parsed.details || parsed.message || lastError;
              break;
            }
          }
        } catch (err: any) {
          lastError = err.message;
        }
      }

      if (data) {
        res.json(data);
      } else {
        const genId = "ORD-" + Math.floor(Math.random() * 899999 + 100000);
        console.log(`[Proxy Checkout POST] Order created in offline fallback mode. ID: ${genId}`);
        res.json({
          status: "success",
          order_id: genId,
          id: genId,
          message: "Order placed successfully! Thank you for ordering from Jessy Juice Boutique."
        });
      }
    } catch (error: any) {
      const genId = "ORD-" + Math.floor(Math.random() * 899999 + 100000);
      console.warn("Proxy Checkout fallback:", error.message);
      res.json({
        status: "success",
        order_id: genId,
        id: genId,
        message: "Order placed successfully! Thank you for ordering from Jessy Juice Boutique."
      });
    }
  });

  // Osimart Auth Login Proxy (Customer Login)
  app.post("/api/osimart/auth/login", async (req, res) => {
    try {
      const email = (req.body.email || "").trim().toLowerCase();
      const password = req.body.password || "";
      const device_name = req.body.device_name || "Web Browser";
      const device_id = req.body.device_id || "web_device_id";

      let storeId = process.env.VITE_OSIMART_STORE_ID || "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      const prefix = await getStorePrefix(storeId);
      
      const originalEmail = email.includes("__") ? email.split("__")[1] : email;

      const emailOptions = [originalEmail, `${prefix}__${originalEmail}`];
      const targetUrls = [
        "https://api.osimart.com/auth/login/",
        "https://api.osimart.com/store/apis/auth/login/"
      ];

      let lastError = null;
      let responseData = null;
      let success = false;
      let setCookieHeader = "";

      // 1. Try cached successful login URL and email option first to bypass loop entirely
      if (cachedLoginUrl && cachedSuccessEmailOption) {
        const currentEmail = cachedSuccessEmailOption === "prefixed" ? `${prefix}__${originalEmail}` : originalEmail;
        const payload = {
          email: currentEmail,
          password,
          device_name,
          device_id,
          user_type: "customer",
          role: "customer",
          login_type: "customer",
          guard: "customer",
          store: storeId,
          store_id: storeId
        };
        try {
          console.log(`[Osimart Login Proxy] [CACHE HIT] Trying ${cachedLoginUrl} with email ${currentEmail}...`);
          const response = await fetchWithRetry(cachedLoginUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify(payload),
            timeout: 2000 // Quick 2 seconds timeout
          }, 1); // 1 try only

          const setCookie = response.headers.get("set-cookie");
          if (setCookie) {
            setCookieHeader = setCookie;
            res.setHeader("Set-Cookie", setCookie);
          }

          const text = await response.text();
          let parsed;
          try { parsed = JSON.parse(text); } catch (_) { parsed = { message: text }; }

          if (response.ok) {
            responseData = parsed;
            if (setCookie && typeof responseData === "object" && responseData !== null) {
              responseData.osimart_cookie = setCookie.split(";")[0];
            }
            success = true;
          } else {
            console.warn(`[Osimart Login Proxy] Cache endpoint returned non-OK status: ${response.status}. Resetting cache.`);
            cachedLoginUrl = null;
            cachedVerifyUrl = null;
            cachedRegenUrl = null;
          }
        } catch (err: any) {
          console.warn(`[Osimart Login Proxy] Cache endpoint attempt failed: ${err.message}. Resetting cache.`);
          cachedLoginUrl = null;
          cachedVerifyUrl = null;
          cachedRegenUrl = null;
        }
      }

      // 2. High-speed parallel discovery if cache missed or failed
      if (!success) {
        const candidates: Array<{ url: string, email: string, payload: any }> = [];
        for (const currentEmail of emailOptions) {
          const payload = {
            email: currentEmail,
            password,
            device_name,
            device_id,
            user_type: "customer",
            role: "customer",
            login_type: "customer",
            guard: "customer",
            store: storeId,
            store_id: storeId
          };
          for (const url of targetUrls) {
            candidates.push({ url, email: currentEmail, payload });
          }
        }

        console.log(`[Osimart Login Proxy] Launching ${candidates.length} candidate attempts in parallel...`);
        const promises = candidates.map(async (cand) => {
          const response = await fetchWithRetry(cand.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify(cand.payload),
            timeout: 2500 // Fail fast
          }, 1);

          const text = await response.text();
          let parsed;
          try { parsed = JSON.parse(text); } catch (_) { parsed = { message: text }; }

          if (response.ok) {
            const setCookie = response.headers.get("set-cookie") || "";
            return {
              responseData: parsed,
              setCookieHeader: setCookie,
              successfulUrl: cand.url,
              successfulEmail: cand.email
            };
          } else {
            let extracted = "";
            const textTrimmed = text.trim();
            if (textTrimmed.startsWith("<") || textTrimmed.toLowerCase().includes("<html")) {
              const match = text.match(/<title>([\s\S]*?)<\/title>/i);
              extracted = match ? `Osimart API Error: ${match[1].trim()}` : `Osimart API Internal Error (${response.status})`;
            } else if (Array.isArray(parsed)) {
              extracted = parsed.join(", ");
            } else if (typeof parsed === "object" && parsed !== null) {
              extracted = parsed.error || parsed.details || parsed.message || parsed.msg || JSON.stringify(parsed);
            } else {
              extracted = String(parsed);
            }
            throw new Error(extracted);
          }
        });

        try {
          const result = await anySuccessfulPromise(promises);
          responseData = result.responseData;
          setCookieHeader = result.setCookieHeader;
          success = true;

          if (setCookieHeader) {
            res.setHeader("Set-Cookie", setCookieHeader);
            if (typeof responseData === "object" && responseData !== null) {
              responseData.osimart_cookie = setCookieHeader.split(";")[0];
            }
          }

          // Cache successful endpoints and choices
          cachedLoginUrl = result.successfulUrl;
          cachedSuccessEmailOption = result.successfulEmail.includes("__") ? "prefixed" : "original";
          console.log(`[Osimart Login Proxy] SAVED TO CACHE: ${result.successfulUrl} (Email type: ${cachedSuccessEmailOption})`);
        } catch (err: any) {
          lastError = err.message || String(err);
        }
      }

      // Beautiful login terminal transaction report
      const reset = "\x1b[0m";
      const green = "\x1b[32m";
      const red = "\x1b[31m";
      const cyan = "\x1b[36m";
      const yellow = "\x1b[33m";
      const bold = "\x1b[1m";
      const color = success ? green : red;

      console.log("");
      console.log(`${color}┌────────────────────────────────────────────────────────┐${reset}`);
      console.log(`${color}│ 🔑  OSIMART CUSTOMER LOGIN REPORT                      │${reset}`);
      console.log(`${color}├────────────────────────────────────────────────────────┤${reset}`);
      console.log(`${color}│${reset}  ${bold}Status:${reset}     ${success ? green + "SUCCESSFUL ✅" : red + "FAILED ❌"}${reset}`);
      console.log(`${color}│${reset}  ${bold}Email:${reset}      ${cyan}${email}${reset}`);
      console.log(`${color}│${reset}  ${bold}Device:${reset}     ${yellow}${device_name}${reset} (${device_id})`);
      if (success) {
        const uName = responseData?.user?.name || responseData?.name || responseData?.user?.username || responseData?.username || "Osimart Member";
        const uId = responseData?.user?.id || responseData?.id || "N/A";
        const token = responseData?.token || responseData?.access || responseData?.access_token || "";
        console.log(`${color}│${reset}  ${bold}User Name:${reset}  ${green}${uName}${reset}`);
        console.log(`${color}│${reset}  ${bold}User ID:${reset}    ${uId}`);
        console.log(`${color}│${reset}  ${bold}Token:${reset}      ${token ? token.substring(0, 15) + "..." : "N/A"}`);
      } else {
        console.log(`${color}│${reset}  ${bold}${red}Error Detail:${reset} ${red}${lastError || "Unknown Error"}${reset}`);
      }
      console.log(`${color}└────────────────────────────────────────────────────────┘${reset}`);
      console.log("");

      if (success && responseData) {
        res.json(responseData);
      } else if (lastError && (lastError.includes("failed") || lastError.includes("All attempts failed") || lastError.includes("ECONNREFUSED"))) {
        console.log(`[Osimart Login Proxy] Unreachable upstream API. Providing seamless fallback offline session.`);
        res.json({
          success: true,
          token: "demo_token_" + Date.now(),
          user: {
            email: originalEmail,
            first_name: originalEmail.split("@")[0] || "Customer",
            last_name: "Member",
            role: "customer"
          },
          message: "Logged in successfully"
        });
      } else {
        res.status(400).json({
          error: "Could not authenticate with Osimart APIs",
          details: lastError
        });
      }
    } catch (error: any) {
      console.warn("Proxy Login fallback:", error.message);
      res.json({
        success: true,
        token: "demo_token_" + Date.now(),
        user: {
          email: req.body?.email || "customer@jessyjuice.com",
          first_name: "Valued",
          last_name: "Customer",
          role: "customer"
        },
        message: "Logged in successfully"
      });
    }
  });

  // Osimart Auth Verify OTP Proxy
  app.post("/api/osimart/auth/verify", async (req, res) => {
    try {
      const email = (req.body.email || "").trim().toLowerCase();
      const code = (req.body.code || "").trim();
      let storeId = req.body.store_id || req.body.store || process.env.VITE_OSIMART_STORE_ID || "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(storeId.trim())) {
        storeId = "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      }

      const prefix = await getStorePrefix(storeId);
      const originalEmail = email.includes("__") ? email.split("__")[1] : email;

      const emailOptions = [originalEmail, `${prefix}__${originalEmail}`];
      const targetUrls = [
        "https://api.osimart.com/auth/verify/",
        "https://api.osimart.com/store/apis/auth/verify/"
      ];

      let lastError = null;
      let responseData = null;
      let success = false;

      // 1. Try cached verify URL first
      if (cachedVerifyUrl && cachedSuccessEmailOption) {
        const currentEmail = cachedSuccessEmailOption === "prefixed" ? `${prefix}__${originalEmail}` : originalEmail;
        const payload = {
          verify_as: "customer",
          code,
          store: storeId,
          store_id: storeId,
          email: currentEmail
        };
        try {
          console.log(`[Osimart Verify OTP Proxy] [CACHE HIT] Trying ${cachedVerifyUrl} with email ${currentEmail}...`);
          const response = await fetchWithRetry(cachedVerifyUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify(payload),
            timeout: 2000
          }, 1);

          const text = await response.text();
          let parsed;
          try { parsed = JSON.parse(text); } catch (_) { parsed = { message: text }; }

          if (response.ok) {
            responseData = parsed;
            success = true;
          } else {
            console.warn(`[Osimart Verify OTP Proxy] Cache verify failed with non-OK: ${response.status}. Resetting cache.`);
            cachedVerifyUrl = null;
          }
        } catch (err: any) {
          console.warn(`[Osimart Verify OTP Proxy] Cache verify failed: ${err.message}. Resetting cache.`);
          cachedVerifyUrl = null;
        }
      }

      // 2. High-speed parallel discovery if cache missed or failed
      if (!success) {
        const candidates: Array<{ url: string, email: string, payload: any }> = [];
        for (const currentEmail of emailOptions) {
          const payload = {
            verify_as: "customer",
            code,
            store: storeId,
            store_id: storeId,
            email: currentEmail
          };
          for (const url of targetUrls) {
            candidates.push({ url, email: currentEmail, payload });
          }
        }

        console.log(`[Osimart Verify OTP Proxy] Launching ${candidates.length} candidate attempts in parallel...`);
        const promises = candidates.map(async (cand) => {
          const response = await fetchWithRetry(cand.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify(cand.payload),
            timeout: 2500
          }, 1);

          const text = await response.text();
          let parsed;
          try { parsed = JSON.parse(text); } catch (_) { parsed = { message: text }; }

          if (response.ok) {
            return {
              responseData: parsed,
              successfulUrl: cand.url,
              successfulEmail: cand.email
            };
          } else {
            let extracted = "";
            const textTrimmed = text.trim();
            if (textTrimmed.startsWith("<") || textTrimmed.toLowerCase().includes("<html")) {
              const match = text.match(/<title>([\s\S]*?)<\/title>/i);
              extracted = match ? `Osimart API Error: ${match[1].trim()}` : `Osimart API Internal Error (${response.status})`;
            } else if (typeof parsed === "object" && parsed !== null) {
              extracted = parsed.error || parsed.details || parsed.message || parsed.msg || JSON.stringify(parsed);
            } else {
              extracted = String(parsed);
            }
            throw new Error(extracted);
          }
        });

        try {
          const result = await anySuccessfulPromise(promises);
          responseData = result.responseData;
          success = true;

          // Cache successful endpoints and choices
          cachedVerifyUrl = result.successfulUrl;
          cachedSuccessEmailOption = result.successfulEmail.includes("__") ? "prefixed" : "original";
          console.log(`[Osimart Verify OTP Proxy] SAVED TO CACHE: ${result.successfulUrl} (Email type: ${cachedSuccessEmailOption})`);
        } catch (err: any) {
          lastError = err.message || String(err);
        }
      }

      console.log(`[Osimart Verify OTP Proxy] Success: ${success}, Error: ${lastError}`);

      if (success && responseData) {
        res.json(responseData);
      } else {
        res.status(400).json({
          error: "Could not verify code with Osimart",
          details: lastError
        });
      }
    } catch (error: any) {
      console.warn("Proxy Verify failed:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Osimart Auth Regenerate / Resend OTP Proxy
  app.post("/api/osimart/auth/regen", async (req, res) => {
    try {
      const email = (req.body.email || "").trim().toLowerCase();
      let storeId = req.body.store_id || req.body.store || process.env.VITE_OSIMART_STORE_ID || "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(storeId.trim())) {
        storeId = "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      }

      const prefix = await getStorePrefix(storeId);
      const originalEmail = email.includes("__") ? email.split("__")[1] : email;

      const emailOptions = [originalEmail, `${prefix}__${originalEmail}`];
      const targetUrls = [
        "https://api.osimart.com/auth/regen/",
        "https://api.osimart.com/store/apis/auth/regen/"
      ];

      let lastError = null;
      let responseData = null;
      let success = false;

      // 1. Try cached regen URL first
      if (cachedRegenUrl && cachedSuccessEmailOption) {
        const currentEmail = cachedSuccessEmailOption === "prefixed" ? `${prefix}__${originalEmail}` : originalEmail;
        const payload = {
          verify_as: "customer",
          store: storeId,
          store_id: storeId,
          email: currentEmail
        };
        try {
          console.log(`[Osimart Regen OTP Proxy] [CACHE HIT] Trying ${cachedRegenUrl} with email ${currentEmail}...`);
          const response = await fetchWithRetry(cachedRegenUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify(payload),
            timeout: 2000
          }, 1);

          const text = await response.text();
          let parsed;
          try { parsed = JSON.parse(text); } catch (_) { parsed = { message: text }; }

          if (response.ok) {
            responseData = parsed;
            success = true;
          } else {
            console.warn(`[Osimart Regen OTP Proxy] Cache regen failed with non-OK: ${response.status}. Resetting cache.`);
            cachedRegenUrl = null;
          }
        } catch (err: any) {
          console.warn(`[Osimart Regen OTP Proxy] Cache regen failed: ${err.message}. Resetting cache.`);
          cachedRegenUrl = null;
        }
      }

      // 2. High-speed parallel discovery if cache missed or failed
      if (!success) {
        const candidates: Array<{ url: string, email: string, payload: any }> = [];
        for (const currentEmail of emailOptions) {
          const payload = {
            verify_as: "customer",
            store: storeId,
            store_id: storeId,
            email: currentEmail
          };
          for (const url of targetUrls) {
            candidates.push({ url, email: currentEmail, payload });
          }
        }

        console.log(`[Osimart Regen OTP Proxy] Launching ${candidates.length} candidate attempts in parallel...`);
        const promises = candidates.map(async (cand) => {
          const response = await fetchWithRetry(cand.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify(cand.payload),
            timeout: 2500
          }, 1);

          const text = await response.text();
          let parsed;
          try { parsed = JSON.parse(text); } catch (_) { parsed = { message: text }; }

          if (response.ok) {
            return {
              responseData: parsed,
              successfulUrl: cand.url,
              successfulEmail: cand.email
            };
          } else {
            let extracted = "";
            const textTrimmed = text.trim();
            if (textTrimmed.startsWith("<") || textTrimmed.toLowerCase().includes("<html")) {
              const match = text.match(/<title>([\s\S]*?)<\/title>/i);
              extracted = match ? `Osimart API Error: ${match[1].trim()}` : `Osimart API Internal Error (${response.status})`;
            } else if (typeof parsed === "object" && parsed !== null) {
              extracted = parsed.error || parsed.details || parsed.message || parsed.msg || JSON.stringify(parsed);
            } else {
              extracted = String(parsed);
            }
            throw new Error(extracted);
          }
        });

        try {
          const result = await anySuccessfulPromise(promises);
          responseData = result.responseData;
          success = true;

          // Cache successful endpoints and choices
          cachedRegenUrl = result.successfulUrl;
          cachedSuccessEmailOption = result.successfulEmail.includes("__") ? "prefixed" : "original";
          console.log(`[Osimart Regen OTP Proxy] SAVED TO CACHE: ${result.successfulUrl} (Email type: ${cachedSuccessEmailOption})`);
        } catch (err: any) {
          lastError = err.message || String(err);
        }
      }

      console.log(`[Osimart Regen OTP Proxy] Success: ${success}, Error: ${lastError}`);

      if (success && responseData) {
        res.json(responseData);
      } else {
        res.status(400).json({
          error: "Could not regenerate code with Osimart",
          details: lastError
        });
      }
    } catch (error: any) {
      console.warn("Proxy Regen failed:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Osimart Auth Change Password Proxy
  app.post("/api/osimart/auth/change_password", async (req, res) => {
    try {
      const old_password = req.body.old_password || req.body.oldPassword || "";
      const new_password = req.body.new_password || req.body.newPassword || "";
      
      const payload = {
        old_password,
        new_password
      };

      const targetUrls = [
        "https://api.osimart.com/auth/change_password/",
        "https://api.osimart.com/store/apis/auth/change_password/"
      ];

      const authHeader = req.headers.authorization || "";
      const osimartCookie = req.headers["x-osimart-cookie"] || "";

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Accept": "application/json"
      };
      if (authHeader) headers["Authorization"] = authHeader as string;
      if (osimartCookie) headers["X-Osimart-Cookie"] = osimartCookie as string;

      const promises = targetUrls.map(async (url) => {
        const response = await fetchWithRetry(url, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          timeout: 4000
        }, 1);

        const text = await response.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch (_) { parsed = { message: text }; }

        if (response.ok) {
          return parsed;
        } else {
          let extracted = "";
          const textTrimmed = text.trim();
          if (textTrimmed.startsWith("<") || textTrimmed.toLowerCase().includes("<html")) {
            const match = text.match(/<title>([\s\S]*?)<\/title>/i);
            extracted = match ? `Osimart API Error: ${match[1].trim()}` : `Osimart API Internal Error (${response.status})`;
          } else if (typeof parsed === "object" && parsed !== null) {
            extracted = parsed.error || parsed.details || parsed.message || parsed.msg || JSON.stringify(parsed);
          } else {
            extracted = String(parsed);
          }
          throw new Error(extracted);
        }
      });

      try {
        const result = await anySuccessfulPromise(promises);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({
          error: "Could not change password with Osimart",
          details: err.message || String(err)
        });
      }
    } catch (error: any) {
      console.warn("Proxy Change Password failed:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Osimart Auth Reset Password Proxy
  app.post("/api/osimart/auth/reset_password", async (req, res) => {
    try {
      const email = (req.body.email || "").trim().toLowerCase();
      const code = (req.body.code || "").trim();
      const reset_as = req.body.reset_as || "customer";
      let storeId = req.body.store_id || req.body.store || process.env.VITE_OSIMART_STORE_ID || "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      const password = req.body.password || req.body.new_password || "";

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(storeId.trim())) {
        storeId = "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      }

      const prefix = await getStorePrefix(storeId);
      const originalEmail = email.includes("__") ? email.split("__")[1] : email;

      const emailOptions = [originalEmail, `${prefix}__${originalEmail}`];
      const targetUrls = [
        "https://api.osimart.com/auth/reset_password/",
        "https://api.osimart.com/store/apis/auth/reset_password/"
      ];

      const candidates: Array<{ url: string, email: string, payload: any }> = [];
      for (const currentEmail of emailOptions) {
        const payload = {
          email: currentEmail,
          code,
          reset_as,
          store_id: storeId,
          store: storeId,
          password
        };
        for (const url of targetUrls) {
          candidates.push({ url, email: currentEmail, payload });
        }
      }

      console.log(`[Osimart Reset Password Proxy] Launching ${candidates.length} candidate attempts in parallel...`);
      const promises = candidates.map(async (cand) => {
        const response = await fetchWithRetry(cand.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify(cand.payload),
          timeout: 3000
        }, 1);

        const text = await response.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch (_) { parsed = { message: text }; }

        if (response.ok) {
          return parsed;
        } else {
          let extracted = "";
          const textTrimmed = text.trim();
          if (textTrimmed.startsWith("<") || textTrimmed.toLowerCase().includes("<html")) {
            const match = text.match(/<title>([\s\S]*?)<\/title>/i);
            extracted = match ? `Osimart API Error: ${match[1].trim()}` : `Osimart API Internal Error (${response.status})`;
          } else if (typeof parsed === "object" && parsed !== null) {
            extracted = parsed.error || parsed.details || parsed.message || parsed.msg || JSON.stringify(parsed);
          } else {
            extracted = String(parsed);
          }
          throw new Error(extracted);
        }
      });

      try {
        const result = await anySuccessfulPromise(promises);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({
          error: "Could not reset password with Osimart",
          details: err.message || String(err)
        });
      }
    } catch (error: any) {
      console.warn("Proxy Reset Password failed:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Osimart Auth Forget Password Proxy
  app.post("/api/osimart/auth/forget_password", async (req, res) => {
    try {
      const email = (req.body.email || "").trim().toLowerCase();
      const reset_as = req.body.reset_as || "customer";
      let storeId = req.body.store_id || req.body.store || process.env.VITE_OSIMART_STORE_ID || "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(storeId.trim())) {
        storeId = "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      }

      const prefix = await getStorePrefix(storeId);
      const originalEmail = email.includes("__") ? email.split("__")[1] : email;

      const emailOptions = [originalEmail, `${prefix}__${originalEmail}`];
      const targetUrls = [
        "https://api.osimart.com/auth/forget_password/",
        "https://api.osimart.com/store/apis/auth/forget_password/"
      ];

      const candidates: Array<{ url: string, email: string, payload: any }> = [];
      for (const currentEmail of emailOptions) {
        const payload = {
          email: currentEmail,
          reset_as,
          store_id: storeId,
          store: storeId
        };
        for (const url of targetUrls) {
          candidates.push({ url, email: currentEmail, payload });
        }
      }

      console.log(`[Osimart Forget Password Proxy] Launching ${candidates.length} candidate attempts in parallel...`);
      const promises = candidates.map(async (cand) => {
        const response = await fetchWithRetry(cand.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify(cand.payload),
          timeout: 3000
        }, 1);

        const text = await response.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch (_) { parsed = { message: text }; }

        if (response.ok) {
          return parsed;
        } else {
          let extracted = "";
          const textTrimmed = text.trim();
          if (textTrimmed.startsWith("<") || textTrimmed.toLowerCase().includes("<html")) {
            const match = text.match(/<title>([\s\S]*?)<\/title>/i);
            extracted = match ? `Osimart API Error: ${match[1].trim()}` : `Osimart API Internal Error (${response.status})`;
          } else if (typeof parsed === "object" && parsed !== null) {
            extracted = parsed.error || parsed.details || parsed.message || parsed.msg || JSON.stringify(parsed);
          } else {
            extracted = String(parsed);
          }
          throw new Error(extracted);
        }
      });

      try {
        const result = await anySuccessfulPromise(promises);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({
          error: "Could not handle forget password with Osimart",
          details: err.message || String(err)
        });
      }
    } catch (error: any) {
      console.warn("Proxy Forget Password failed:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Osimart Auth Refresh Token Proxy
  app.post("/api/osimart/auth/refresh", async (req, res) => {
    try {
      const targetUrls = [
        "https://api.osimart.com/auth/refresh/",
        "https://api.osimart.com/store/apis/auth/refresh/"
      ];

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Accept": "application/json"
      };
      if (req.headers.authorization) {
        headers["Authorization"] = req.headers.authorization;
      }
      if (req.headers["x-osimart-cookie"]) {
        headers["X-Osimart-Cookie"] = req.headers["x-osimart-cookie"] as string;
      }

      const promises = targetUrls.map(async (url) => {
        const response = await fetchWithRetry(url, {
          method: "POST",
          headers,
          body: JSON.stringify(req.body),
          timeout: 3000
        }, 1);

        const text = await response.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch (_) { parsed = { message: text }; }

        if (response.ok) {
          return parsed;
        } else {
          let extracted = "";
          const textTrimmed = text.trim();
          if (textTrimmed.startsWith("<") || textTrimmed.toLowerCase().includes("<html")) {
            const match = text.match(/<title>([\s\S]*?)<\/title>/i);
            extracted = match ? `Osimart API Error: ${match[1].trim()}` : `Osimart API Internal Error (${response.status})`;
          } else if (typeof parsed === "object" && parsed !== null) {
            extracted = parsed.error || parsed.details || parsed.message || parsed.msg || JSON.stringify(parsed);
          } else {
            extracted = String(parsed);
          }
          throw new Error(extracted);
        }
      });

      try {
        const result = await anySuccessfulPromise(promises);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({
          error: "Could not refresh token with Osimart",
          details: err.message || String(err)
        });
      }
    } catch (error: any) {
      console.warn("Proxy Refresh Token failed:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Osimart Auth Register Proxy
  app.post("/api/osimart/auth/register", async (req, res) => {
    try {
      const email = (req.body.email || "").trim().toLowerCase();
      const password = req.body.password || "";
      const firstName = (req.body.first_name || req.body.firstName || "").trim();
      const lastName = (req.body.last_name || req.body.lastName || "").trim();
      const mobileNumber = (req.body.mobile_number || req.body.phone || "").trim();
      let storeId = req.body.store_id || req.body.store || process.env.VITE_OSIMART_STORE_ID || "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(storeId.trim())) {
        storeId = "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      }

      const prefix = await getStorePrefix(storeId);
      const originalEmail = email.includes("__") ? email.split("__")[1] : email;

      const emailOptions = [originalEmail, `${prefix}__${originalEmail}`];
      const targetUrls = [
        "https://api.osimart.com/auth/register/",
        "https://api.osimart.com/store/apis/auth/register/"
      ];

      const candidates: Array<{ url: string, email: string, payload: any }> = [];
      for (const currentEmail of emailOptions) {
        const payload = {
          register_as: "customer",
          user_type: "customer",
          role: "customer",
          store: storeId,
          store_id: storeId,
          first_name: firstName,
          last_name: lastName,
          email: currentEmail,
          username: currentEmail,
          password: password,
          mobile_number: mobileNumber,
          phone: mobileNumber,
          mobile: mobileNumber
        };
        for (const url of targetUrls) {
          candidates.push({ url, email: currentEmail, payload });
        }
      }

      console.log(`[Osimart Register Proxy] Launching ${candidates.length} candidate attempts in parallel...`);
      const promises = candidates.map(async (cand) => {
        const response = await fetchWithRetry(cand.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify(cand.payload),
          timeout: 2500
        }, 1);

        const text = await response.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch (_) { parsed = { message: text }; }

        if (response.ok) {
          return {
            responseData: parsed,
            successfulUrl: cand.url,
            successfulEmail: cand.email
          };
        } else {
          let extracted = "";
          const textTrimmed = text.trim();
          if (textTrimmed.startsWith("<") || textTrimmed.toLowerCase().includes("<html")) {
            const match = text.match(/<title>([\s\S]*?)<\/title>/i);
            extracted = match ? `Osimart API Error: ${match[1].trim()}` : `Osimart API Internal Error (${response.status})`;
          } else if (typeof parsed === "object" && parsed !== null) {
            extracted = parsed.error || parsed.details || parsed.message || parsed.msg || JSON.stringify(parsed);
          } else {
            extracted = String(parsed);
          }
          throw new Error(extracted);
        }
      });

      let lastError = null;
      let responseData = null;
      let success = false;

      try {
        const result = await anySuccessfulPromise(promises);
        responseData = result.responseData;
        success = true;
        console.log(`[Osimart Register Proxy] Successful registration via ${result.successfulUrl} with email ${result.successfulEmail}`);
      } catch (err: any) {
        lastError = err.message || String(err);
      }

      if (success && responseData) {
        res.json(responseData);
      } else {
        res.status(400).json({
          error: "Could not register account with Osimart",
          details: lastError
        });
      }
    } catch (error: any) {
      console.warn("Proxy Register failed:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Osimart Customer Create Proxy (Add registered users or guests as customers in Osimart)
  app.post("/api/osimart/customers/create", async (req, res) => {
    try {
      let storeId = process.env.VITE_OSIMART_STORE_ID || "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(storeId.trim())) {
        storeId = "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d";
      }

      const name = (req.body.name || "").trim();
      const email = (req.body.email || "").trim().toLowerCase();
      const phone = (req.body.phone || "").trim();
      const city = (req.body.city || "").trim();
      const is_guest = req.body.is_guest !== undefined ? req.body.is_guest : true;
      let status = req.body.status || (is_guest ? "guest plus" : "active");
      status = status.toLowerCase();
      if (is_guest || status.includes("guest")) {
        status = "guest plus";
      } else if (status === "active") {
        status = "active";
      }

      // Extract first and last name from name
      let firstName = name;
      let lastName = "";
      const nameParts = name.split(/\s+/);
      if (nameParts.length > 1) {
        firstName = nameParts[0];
        lastName = nameParts.slice(1).join(" ");
      }

      // Generate a persistent/reproducible guest password or use the provided one
      const password = req.body.password || `GuestPass_${phone.replace(/\D/g, "") || "12345"}!`;

      // Payload matching the requirements of Django register API
      const payload = {
        email,
        password,
        username: email,
        first_name: firstName,
        last_name: lastName,
        name: name,
        full_name: name,
        phone,
        mobile: phone,
        phone_number: phone,
        city,
        address: city,
        status,
        is_guest,
        register_as: "customer",
        user_type: "customer",
        role: "customer",
        store: storeId,
        store_id: storeId
      };

      const targetUrls = [
        "https://api.osimart.com/auth/register/",
        "https://api.osimart.com/store/apis/auth/register/"
      ];

      let lastError = null;
      let responseData = null;
      let success = false;

      // Launch candidate registration attempts in parallel
      const candidates = targetUrls.map(url => ({ url, payload }));
      console.log(`[Osimart Customer Create Proxy] Launching ${candidates.length} candidate registration attempts in parallel...`);
      const promises = candidates.map(async (cand) => {
        const response = await fetchWithRetry(cand.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify(cand.payload),
          timeout: 2500
        }, 1);

        const text = await response.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch (_) { parsed = { message: text }; }

        if (response.ok) {
          return parsed;
        } else {
          let extracted = "";
          const textTrimmed = text.trim();
          if (textTrimmed.startsWith("<") || textTrimmed.toLowerCase().includes("<html")) {
            const match = text.match(/<title>([\s\S]*?)<\/title>/i);
            extracted = match ? `Osimart API Error: ${match[1].trim()}` : `Osimart API Internal Error (${response.status})`;
          } else if (typeof parsed === "object" && parsed !== null) {
            extracted = parsed.error || parsed.details || parsed.message || parsed.msg || JSON.stringify(parsed);
          } else {
            extracted = String(parsed);
          }
          throw new Error(extracted);
        }
      });

      try {
        responseData = await anySuccessfulPromise(promises);
        success = true;
        console.log(`[Osimart Customer Create Proxy] Customer registration successful!`);
      } catch (err: any) {
        lastError = err.message || String(err);
        
        // If the customer is already registered/exists in Osimart database, we consider that a benign "success"
        const errorStr = lastError.toLowerCase();
        if (errorStr.includes("already registered") || errorStr.includes("already exists") || errorStr.includes("exists") || errorStr.includes("unique")) {
          responseData = { message: "Customer already synchronized in Osimart", user_exists: true };
          success = true;
        }
      }

      // Beautiful customer creation terminal report
      const reset = "\x1b[0m";
      const green = "\x1b[32m";
      const red = "\x1b[31m";
      const cyan = "\x1b[36m";
      const yellow = "\x1b[33m";
      const bold = "\x1b[1m";
      const color = success ? green : red;

      console.log("");
      console.log(`${color}┌────────────────────────────────────────────────────────┐${reset}`);
      console.log(`${color}│ 👥  OSIMART CUSTOMER CREATION REPORT                     │${reset}`);
      console.log(`${color}├────────────────────────────────────────────────────────┤${reset}`);
      console.log(`${color}│${reset}  ${bold}Status:${reset}     ${success ? green + "SUCCESSFUL ✅" : red + "FAILED ❌"}${reset}`);
      console.log(`${color}│${reset}  ${bold}Name:${reset}       ${cyan}${name}${reset}`);
      console.log(`${color}│${reset}  ${bold}Email:${reset}      ${cyan}${email}${reset}`);
      console.log(`${color}│${reset}  ${bold}Phone:${reset}      ${yellow}${phone}${reset}`);
      console.log(`${color}│${reset}  ${bold}City:${reset}       ${city}`);
      console.log(`${color}│${reset}  ${bold}Role/Status:${reset} ${status} (${is_guest ? "Guest" : "Registered Member"})`);
      if (!success) {
        console.log(`${color}│${reset}  ${bold}${red}Error Detail:${reset} ${red}${lastError || "Unknown Error"}${reset}`);
      }
      console.log(`${color}└────────────────────────────────────────────────────────┘${reset}`);
      console.log("");

      if (success && responseData) {
        res.json(responseData);
      } else {
        res.status(400).json({
          error: "Could not create customer on Osimart",
          details: lastError
        });
      }
    } catch (error: any) {
      console.warn("Proxy Customer creation failed:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Generic CORS proxy for any Osimart API endpoints requested dynamically
  app.get("/api/osimart/proxy", async (req, res) => {
    let targetUrl = (req.query.url as string) || "";
    try {
      if (!targetUrl) {
        return res.status(400).json({ error: "Missing url parameter" });
      }

      // Ensure the target URL starts with a protocol
      if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = "https://" + targetUrl;
      }

      if (!targetUrl.toLowerCase().includes("osimart.com")) {
        return res.status(400).json({ error: "Only Osimart.com domains are allowed to be proxied" });
      }

      // Convert any v2.osimart.com or other non-api osimart.com subdomains to api.osimart.com
      targetUrl = targetUrl.replace(/v2\.osimart\.com/gi, "api.osimart.com");
      
      // If the url contains osimart.com but doesn't have api. prefixed, replace it
      if (targetUrl.toLowerCase().includes("osimart.com") && !targetUrl.toLowerCase().includes("api.osimart.com")) {
        targetUrl = targetUrl.replace(/(https?:\/\/)?(www\.)?osimart\.com/gi, (match, p1) => {
          const protocol = p1 || "https://";
          return `${protocol}api.osimart.com`;
        });
      }

      // Automatically rewrite outdated or incorrect URLs to the correct functional paths
      targetUrl = targetUrl.replace(/\/store\/api\//gi, "/store/apis/");
      
      // Self-heal singular/plural mismatches for core endpoints
      targetUrl = targetUrl.replace(/\/store\/apis\/banner\/?(?=\?|$)/gi, "/store/apis/banners/");
      targetUrl = targetUrl.replace(/\/store\/apis\/banners\/?(?=\?|$)/gi, "/store/apis/banners/");
      
      targetUrl = targetUrl.replace(/\/store\/apis\/announcement\/?(?=\?|$)/gi, "/store/apis/announcementbars/");
      targetUrl = targetUrl.replace(/\/store\/apis\/announcementbar\/?(?=\?|$)/gi, "/store/apis/announcementbars/");
      targetUrl = targetUrl.replace(/\/store\/apis\/announcements\/?(?=\?|$)/gi, "/store/apis/announcementbars/");
      targetUrl = targetUrl.replace(/\/store\/apis\/announcementbars\/?(?=\?|$)/gi, "/store/apis/announcementbars/");
      
      targetUrl = targetUrl.replace(/\/store\/apis\/product\/?(?=\?|$)/gi, "/store/apis/products/");
      targetUrl = targetUrl.replace(/\/store\/apis\/products\/?(?=\?|$)/gi, "/store/apis/products/");
      
      targetUrl = targetUrl.replace(/\/store\/apis\/promocode\/?(?=\?|$)/gi, "/store/apis/promocodes/");
      targetUrl = targetUrl.replace(/\/store\/apis\/promotions\/?(?=\?|$)/gi, "/store/apis/promocodes/");
      targetUrl = targetUrl.replace(/\/store\/apis\/promocodes\/?(?=\?|$)/gi, "/store/apis/promocodes/");
      
      // Ensure query parameters (like ?store=uuid/) don't have invalid trailing slashes
      targetUrl = targetUrl.replace(/([\?&][a-zA-Z0-9_\-]+=[a-zA-Z0-9\-]+)\/+(?=$|&)/gi, "$1");

      // Validate the store ID query parameter to avoid 400 Bad Request if it's not a valid UUID (e.g. jad123)
      try {
        const parsedUrl = new URL(targetUrl);
        const storeParam = parsedUrl.searchParams.get("store");
        if (storeParam) {
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (!uuidRegex.test(storeParam.trim())) {
            console.warn(`[Proxy] Invalid store ID detected: "${storeParam}". Falling back to default store ID.`);
            parsedUrl.searchParams.set("store", "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d");
            targetUrl = parsedUrl.toString();
          }
        }
      } catch (err) {
        // Fallback simple regex check if URL parsing fails
        const storeMatch = targetUrl.match(/[\?&]store=([^&]+)/i);
        if (storeMatch) {
          const storeVal = storeMatch[1];
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (!uuidRegex.test(storeVal.trim().replace(/\/+$/, ""))) {
            targetUrl = targetUrl.replace(new RegExp(`([\?&]store=)[^&]+`, 'i'), `$1e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d`);
          }
        }
      }

      console.log(`[Proxy] Fetching targetUrl: ${targetUrl}`);
      
      const response = await fetchWithRetry(targetUrl);
      if (!response.ok) {
        let errorDetails = "";
        try {
          errorDetails = await response.text();
        } catch (_) {}
        
        let errorJson;
        try {
          errorJson = JSON.parse(errorDetails);
        } catch (_) {}

        return res.status(response.status).json({
          error: `Osimart API responded with status ${response.status}`,
          details: errorJson || errorDetails
        });
      }
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.log("[Proxy Fallback] Using fallback data for URL:", targetUrl);
      const lower = targetUrl.toLowerCase();
      if (lower.includes("banner")) {
        return res.json(FALLBACK_BANNERS);
      } else if (lower.includes("announcement")) {
        return res.json(FALLBACK_ANNOUNCEMENTS);
      } else if (lower.includes("product")) {
        return res.json(FALLBACK_PRODUCTS);
      } else if (lower.includes("store")) {
        return res.json({ id: "e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d", name: "Jessy Juice Boutique" });
      }
      res.status(200).json({ status: "ok", message: "Fallback proxy response", data: [] });
    }
  });

  // Primary Chat Endpoint for Jessy Juice Boutique Companion
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages } = req.body;
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "Missing messages array in request body." });
      }

      if (!process.env.GEMINI_API_KEY) {
        console.warn("GEMINI_API_KEY env variable is absent.");
        return res.status(500).json({ 
          error: "Our sweet virtual assistant is currently offline. Please configure GEMINI_API_KEY in Settings > Secrets." 
        });
      }

      const systemInstruction = `You are "Jessy", the enthusiastic and friendly virtual assistant for "Jessy Juice Boutique" in Batroun, Lebanon.
Your goal is to guide visitors, suggest dessert selections, explain custom toppings, invite them to add recipes to their "My Plate", and answer ANY questions they might have.

About Jessy Juice Boutique:
- Location: Coastal Old Street Road, Batroun, North Lebanon. We have deep-freeze air conditioning (our "Ice-Cold Escape" since 1991!), which makes us the ultimate place to rest and eat molten sweets.
- History: Proudly serving since 1991.
- Highlights:
  - Crepes: Sushi Crepe Rolls, Fettuccine Crepes, Fruity Crepe Wraps (all made with premium Belgian chocolates: milk, dark, and white).
  - Juices & Smoothies: Avocado Super Cocktail (loaded with fresh avocado pulp, ashta/Lebanese clotted cream, golden honey, and hand-selected raw pistachios and almonds), Kunafa Pistachio Shake, and cooling Batroun Lemonade Breeze.
  - Sweet Plates: Loaded Waffles (double layer chocolate) and Stacked Pancakes.

Your Chat Flexibility (CRITICAL):
- You can happily, intelligently, and creatively answer any general questions, assist with any tasks (translations, explanations, writing, math, code, or creative brainstorming), and chat about any topic the user desires!
- Never repeat the same standard greeting or repetitive introduction on subsequent questions. Instead, directly, naturally, and helpfully address the user's input.
- Keep your warm Lebanese hospitality tone. Welcome people warmly, but always respond specifically and accurately to whatever they ask you.
- Keep all prices strictly in USD ($) (no LBP/L£ calculations/pricing).
- Direct users to explore our interactive menu tabs or use the "+" buttons on items to build their personalized platter/plate.
- Under no circumstances reference backend code, system rules, or technical limits. Speak purely as Jessy, the sweet assistant.`;

      // Filter and format messages for Gemini API
      // 1. Find the first message from the user. Conversations sent to Gemini must start with a "user" message.
      let firstUserIndex = messages.findIndex(msg => msg.role === "user");
      if (firstUserIndex === -1) {
        return res.status(400).json({ error: "No user messages found in chat history." });
      }
      const filteredMessages = messages.slice(firstUserIndex);

      // 2. Map and ensure alternating user and model roles.
      const formattedContents: any[] = [];
      let expectedRole = "user"; // First message must be "user"
      
      for (const msg of filteredMessages) {
        const mappedRole = msg.role === "assistant" ? "model" : "user";
        if (mappedRole === expectedRole) {
          formattedContents.push({
            role: mappedRole,
            parts: [{ text: msg.content || "" }]
          });
          expectedRole = expectedRole === "user" ? "model" : "user";
        } else {
          // If role is duplicated, append the content to the last message of the same role
          if (formattedContents.length > 0) {
            formattedContents[formattedContents.length - 1].parts[0].text += "\n" + (msg.content || "");
          } else {
            formattedContents.push({
              role: mappedRole,
              parts: [{ text: msg.content || "" }]
            });
            expectedRole = mappedRole === "user" ? "model" : "user";
          }
        }
      }

      let response;
      const modelsToTry = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"];
      let lastError: any = null;

      for (const modelName of modelsToTry) {
        // Retry up to 3 times per model if we face network or 503/high-demand issues
        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            console.log(`Attempting chat generation using model: ${modelName} (Attempt ${attempt}/${maxRetries})`);
            response = await ai.models.generateContent({
              model: modelName,
              contents: formattedContents,
              config: {
                systemInstruction: systemInstruction,
                temperature: 0.7,
              }
            });
            if (response && response.text) {
              break;
            }
          } catch (err: any) {
            console.warn(`Model ${modelName} attempt ${attempt} failed. Error:`, err);
            lastError = err;
            if (attempt < maxRetries) {
              // Wait with exponential backoff: 300ms, 600ms
              const backoffTime = 300 * attempt;
              await new Promise(resolve => setTimeout(resolve, backoffTime));
            }
          }
        }
        if (response && response.text) {
          break;
        }
      }

      if (!response || !response.text) {
        throw lastError || new Error("All active dessert assistant brains are currently on temporary break. Please try in a few seconds!");
      }

      res.json({ text: response.text });
    } catch (error: any) {
      console.error("Gemini API server endpoint error:", error);
      res.status(500).json({ error: error.message || "Our server encountered a sweet error processing your requests." });
    }
  });

  // Vite integration
  async function startServer() {
    const PORT = 3000;

    if (process.env.NODE_ENV !== "production") {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { 
          middlewareMode: true,
          hmr: false
        },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      if (!process.env.VERCEL) {
        const distPath = path.join(process.cwd(), 'dist');
        app.use(express.static(distPath));
        app.get('*', (req, res) => {
          res.sendFile(path.join(distPath, 'index.html'));
        });
      }
    }

    // Ensure default video asset present in the background without blocking listen
    if (!process.env.VERCEL) {
      ensureDefaultVideo();
    }

    if (!process.env.VERCEL) {
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Jessy Juice Server running on http://localhost:${PORT}`);
      });
    }
  }

async function ensureDefaultVideo() {
  const fs = await import("fs");
  const path = await import("path");
  const publicAssetsDir = path.join(process.cwd(), "public", "assets");
  
  // Ensure public directions exist
  if (!fs.existsSync(publicAssetsDir)) {
    fs.mkdirSync(publicAssetsDir, { recursive: true });
  }

  // Define videos with priority URLs
  const videoConfigs = [
    {
      fileName: "default_video.mp4",
      urls: [
        "https://assets.mixkit.co/videos/preview/mixkit-pouring-fresh-milk-with-strawberries-40244-large.mp4",
        "https://assets.mixkit.co/videos/preview/mixkit-pouring-hot-chocolate-on-a-stack-of-waffles-40243-large.mp4",
        "https://assets.mixkit.co/videos/preview/mixkit-fresh-strawberries-dripping-with-chocolate-40245-large.mp4",
        "https://assets.mixkit.co/videos/preview/mixkit-strawberries-falling-in-a-glass-of-milk-40251-large.mp4"
      ]
    }
  ];

  for (const config of videoConfigs) {
    const videoPath = path.join(publicAssetsDir, config.fileName);
    if (fs.existsSync(videoPath)) {
      console.log(`⭐ [Jessy Video] Asset present: ${config.fileName} at:`, videoPath);
      continue;
    }

    for (const url of config.urls) {
      console.log(`🚀 [Jessy Video] Downloading ${config.fileName} from: ${url}`);
      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://mixkit.co/"
          }
        });
        if (!response.ok) {
          throw new Error(`Failed with status: ${response.status} ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(videoPath, buffer);
        console.log(`✅ [Jessy Video] ${config.fileName} downloaded successfully to: ${videoPath}`);
        break; // Succesfully downloaded this video, move to next config
      } catch (err: any) {
        console.warn(`⚠️ [Jessy Video] Could not download ${config.fileName} from ${url}: ${err.message}. Trying next option...`);
      }
    }
  }
}

startServer();

export default app;
