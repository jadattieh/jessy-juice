// Osimart API Service for Banners, Announcements, Products, and Promos

// Retrieve endpoints from environment variables or use fallback defaults
export const OSIMART_STORE_ID = import.meta.env.VITE_OSIMART_STORE_ID || 'e2ee7b5c-1130-43c2-a8cb-054cc6b8bb9d';
export const OSIMART_BANNERS_API_URL = import.meta.env.VITE_OSIMART_BANNERS_API_URL || `https://api.osimart.com/store/apis/banners/?store=${OSIMART_STORE_ID}`;

// Additional Osimart Store Endpoints (Step 2 Expansion)
export const OSIMART_ANNOUNCEMENTS_API_URL = `https://api.osimart.com/store/apis/announcementbars/?store=${OSIMART_STORE_ID}`;
export const OSIMART_PRODUCTS_API_URL = `https://api.osimart.com/store/apis/products/?store=${OSIMART_STORE_ID}`;
export const OSIMART_PROMO_CODES_API_URL = `https://api.osimart.com/store/apis/promocodes/?store=${OSIMART_STORE_ID}`;

export function normalizeOsimartUrl(url: string): string {
  if (!url) return '';
  let trimmed = url.trim();
  
  // Ensure the URL starts with a protocol if it contains osimart.com
  if (trimmed.toLowerCase().includes('osimart.com') && !/^https?:\/\//i.test(trimmed)) {
    trimmed = 'https://' + trimmed;
  }

  // Convert any v2.osimart.com or other non-api osimart.com subdomains to api.osimart.com
  trimmed = trimmed.replace(/v2\.osimart\.com/gi, 'api.osimart.com');
  
  // If the url contains osimart.com but doesn't have api. prefixed, replace it
  if (trimmed.toLowerCase().includes('osimart.com') && !trimmed.toLowerCase().includes('api.osimart.com')) {
    // Avoid double-prefixing if there's already some other subdomain like www.osimart.com
    trimmed = trimmed.replace(/(https?:\/\/)?(www\.)?osimart\.com/gi, (match, p1) => {
      const protocol = p1 || 'https://';
      return `${protocol}api.osimart.com`;
    });
  }

  trimmed = trimmed.replace(/\/store\/api\//gi, '/store/apis/');
  
  // Self-heal singular/plural mismatches for core endpoints
  trimmed = trimmed.replace(/\/store\/apis\/banner\/?(?=\?|$)/gi, '/store/apis/banners/');
  trimmed = trimmed.replace(/\/store\/apis\/banners\/?(?=\?|$)/gi, '/store/apis/banners/');
  
  trimmed = trimmed.replace(/\/store\/apis\/announcement\/?(?=\?|$)/gi, '/store/apis/announcementbars/');
  trimmed = trimmed.replace(/\/store\/apis\/announcementbar\/?(?=\?|$)/gi, '/store/apis/announcementbars/');
  trimmed = trimmed.replace(/\/store\/apis\/announcements\/?(?=\?|$)/gi, '/store/apis/announcementbars/');
  trimmed = trimmed.replace(/\/store\/apis\/announcementbars\/?(?=\?|$)/gi, '/store/apis/announcementbars/');
  
  trimmed = trimmed.replace(/\/store\/apis\/product\/?(?=\?|$)/gi, '/store/apis/products/');
  trimmed = trimmed.replace(/\/store\/apis\/products\/?(?=\?|$)/gi, '/store/apis/products/');
  
  trimmed = trimmed.replace(/\/store\/apis\/promocode\/?(?=\?|$)/gi, '/store/apis/promocodes/');
  trimmed = trimmed.replace(/\/store\/apis\/promotions\/?(?=\?|$)/gi, '/store/apis/promocodes/');
  trimmed = trimmed.replace(/\/store\/apis\/promocodes\/?(?=\?|$)/gi, '/store/apis/promocodes/');

  // Ensure query parameters (like ?store=uuid/) don't have invalid trailing slashes
  trimmed = trimmed.replace(/([\?&][a-zA-Z0-9_\-]+=[a-zA-Z0-9\-]+)\/+(?=$|&)/gi, '$1');

  return trimmed;
}

/**
 * Sanitizes Osimart badges to clean English and removes any Arabic/mixed stock texts
 */
export function sanitizeOsimartBadge(badge: string, quantity: number = 2): string {
  if (!badge) return '';
  const trimmed = badge.trim();
  const cleaned = trimmed.toLowerCase();
  if (
    cleaned.includes('moutawafer') || 
    cleaned.includes('متوفر') || 
    cleaned.includes('2/2') || 
    cleaned.includes('/')
  ) {
    const qty = (quantity !== undefined && quantity !== null) ? quantity : 2;
    return `${qty} left`;
  }
  return trimmed;
}

/**
 * Helper to bypass browser CORS constraints when calling external Osimart APIs directly.
 * Dynamically routes requests through the Node Express backend's proxy handler.
 */
function getProxyUrl(url: string): string {
  const normalized = normalizeOsimartUrl(url);
  if (normalized.toLowerCase().includes('osimart.com')) {
    return `/api/osimart/proxy?url=${encodeURIComponent(normalized)}`;
  }
  return normalized;
}

export interface OsimartBanner {
  id?: string | number;
  title?: string;
  description?: string;
  image?: string;
  image_url?: string;
  button_text?: string;
  link?: string;
  active?: boolean;
}

export interface OsimartAnnouncement {
  id?: string | number;
  text: string;
  active?: boolean;
  color_background?: string;
  color_text?: string;
}

export interface OsimartProduct {
  id: string | number;
  name: string;
  description: string;
  price: number;
  image: string;
  category?: string;
  is_popular?: boolean;
  badge?: string;
  quantity?: number;
  variants?: any[];
}

export interface OsimartPromoCode {
  code: string;
  discount_percentage: number;
  active: boolean;
  minimum_order_amount?: number;
}

/**
 * Fetches store banners from Osimart API
 */
export async function fetchStoreBanners(url: string = OSIMART_BANNERS_API_URL): Promise<OsimartBanner[]> {
  try {
    const response = await fetch(getProxyUrl(url), {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    
    let list: any[] = [];
    if (Array.isArray(data)) {
      list = data;
    } else if (data && Array.isArray(data.results)) {
      list = data.results;
    } else if (data && Array.isArray(data.data)) {
      list = data.data;
    }

    return list.map(b => {
      let img = '';
      if (b.image) {
        if (typeof b.image === 'string') {
          img = b.image;
        } else if (typeof b.image === 'object' && b.image.path) {
          img = b.image.path.startsWith('http') ? b.image.path : `https://api.osimart.com/${b.image.path}`;
        }
      } else if (b.image_url) {
        img = b.image_url;
      }
      return {
        id: b.id,
        title: b.title || '',
        description: b.subtitle || b.description || '',
        image: img,
        image_url: img,
        button_text: b.button_title !== undefined && b.button_title !== null ? b.button_title : (b.button_text || ''),
        link: b.link || '',
        active: b.active !== false
      };
    });
  } catch (error) {
    console.warn('Error fetching Osimart store banners:', error);
    throw error;
  }
}

/**
 * Fetches the active top announcement bar from Osimart API
 */
export async function fetchStoreAnnouncements(url: string = OSIMART_ANNOUNCEMENTS_API_URL): Promise<OsimartAnnouncement[]> {
  try {
    const response = await fetch(getProxyUrl(url), {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    
    let list: any[] = [];
    if (Array.isArray(data)) {
      list = data;
    } else if (data && Array.isArray(data.results)) {
      list = data.results;
    } else if (data && Array.isArray(data.data)) {
      list = data.data;
    }

    return list.map(a => ({
      id: a.id,
      text: a.content || a.text || '',
      active: a.active !== false,
      color_background: a.bg_color || a.color_background || '#000000',
      color_text: a.text_color || a.color_text || '#FFFFFF'
    }));
  } catch (error) {
    console.warn('Error fetching Osimart store announcements:', error);
    return [];
  }
}

/**
 * Fetches real products from the Osimart API
 */
export async function fetchStoreProducts(url: string = OSIMART_PRODUCTS_API_URL): Promise<OsimartProduct[]> {
  try {
    const response = await fetch(getProxyUrl(url), {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    
    let productsList: any[] = [];
    if (Array.isArray(data)) {
      productsList = data;
    } else if (data && Array.isArray(data.results)) {
      productsList = data.results;
    } else if (data && Array.isArray(data.data)) {
      productsList = data.data;
    }

    // Map fields cleanly to conform with frontend properties
    return productsList.map(p => {
      let img = '/assets/honey_strawberries_bg.png';
      if (p.main_image) {
        if (typeof p.main_image === 'string') {
          img = p.main_image;
        } else if (typeof p.main_image === 'object' && p.main_image.path) {
          img = p.main_image.path.startsWith('http') ? p.main_image.path : `https://api.osimart.com/${p.main_image.path}`;
        }
      } else if (p.image) {
        img = typeof p.image === 'string' ? p.image : (p.image.path ? `https://api.osimart.com/${p.image.path}` : img);
      } else if (p.image_url) {
        img = p.image_url;
      }

      // Extract price
      let price = 0;
      if (p.price_range) {
        price = parseFloat(p.price_range);
      } else if (p.price) {
        price = parseFloat(p.price);
      }

      // Map category name to frontend categories (chocolate, juice, icecream, cake)
      let cat = 'chocolate';
      if (p.categories && p.categories.length > 0) {
        const catObj = p.categories[0].category;
        if (catObj) {
          const name = (catObj.name || '').toLowerCase();
          const slug = (catObj.slugified_name || '').toLowerCase();
          
          if (slug.includes('juice') || slug.includes('drink') || slug.includes('cocktail') || slug.includes('smoothie') || slug.includes('beverage') ||
              name.includes('juice') || name.includes('drink') || name.includes('cocktail') || name.includes('smoothie') || name.includes('beverage')) {
            cat = 'juice';
          } else if (slug.includes('ice') || slug.includes('cream') || slug.includes('shake') || slug.includes('gelato') ||
                     name.includes('ice') || name.includes('cream') || name.includes('shake') || name.includes('gelato')) {
            cat = 'icecream';
          } else if (slug.includes('cake') || slug.includes('lava') || slug.includes('muffin') || slug.includes('bakery') ||
                     name.includes('cake') || name.includes('lava') || name.includes('muffin') || name.includes('bakery')) {
            cat = 'cake';
          } else if (slug.includes('crepe') || slug.includes('chocolate') || slug.includes('waffle') || slug.includes('sweet') ||
                     name.includes('crepe') || name.includes('chocolate') || name.includes('waffle') || name.includes('sweet')) {
            cat = 'chocolate';
          } else {
            cat = slug || 'chocolate';
          }
        }
      }

      // Strip HTML tags from description for clean frontend rendering
      let desc = p.description || '';
      if (desc && desc.includes('<')) {
        desc = desc.replace(/<[^>]*>/g, '').trim();
      }

      const finalPrice = Number(isNaN(price) ? 0 : price);

      let stockQty = 99;
      if (p.stock_quantity !== undefined && p.stock_quantity !== null) {
        stockQty = Number(p.stock_quantity);
      } else if (p.remaining_stock !== undefined && p.remaining_stock !== null) {
        stockQty = Number(p.remaining_stock);
      } else if (p.quantity !== undefined && p.quantity !== null) {
        stockQty = Number(p.quantity);
      }

      return {
        id: p.id || p.uid,
        name: p.name || p.title,
        description: desc,
        price: finalPrice,
        priceLabel: `$${finalPrice.toFixed(2)}`,
        image: img,
        category: cat,
        is_popular: !!(p.is_popular || p.featured),
        isPopular: !!(p.is_popular || p.featured),
        badge: sanitizeOsimartBadge(p.badge || (p.featured ? 'Popular' : ''), stockQty),
        quantity: stockQty,
        variants: p.variants || p.variant_types || p.product_variants || []
      };
    });
  } catch (error) {
    console.warn('Error fetching Osimart store products:', error);
    return [];
  }
}

/**
 * Fetches details for a single product from Osimart API
 */
export async function fetchStoreProductDetail(id: string | number): Promise<OsimartProduct | null> {
  try {
    // Call the newly created server-side proxy endpoint
    const url = `/api/osimart/products/${id}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const p = await response.json();
    if (!p) return null;

    let img = '/assets/honey_strawberries_bg.png';
    if (p.main_image) {
      if (typeof p.main_image === 'string') {
        img = p.main_image;
      } else if (typeof p.main_image === 'object' && p.main_image.path) {
        img = p.main_image.path.startsWith('http') ? p.main_image.path : `https://api.osimart.com/${p.main_image.path}`;
      }
    } else if (p.image) {
      img = typeof p.image === 'string' ? p.image : (p.image.path ? `https://api.osimart.com/${p.image.path}` : img);
    } else if (p.image_url) {
      img = p.image_url;
    }

    let price = 0;
    if (p.price_range) {
      price = parseFloat(p.price_range);
    } else if (p.price) {
      price = parseFloat(p.price);
    }

    let cat = 'chocolate';
    if (p.categories && p.categories.length > 0) {
      const catObj = p.categories[0].category;
      if (catObj) {
        const name = (catObj.name || '').toLowerCase();
        const slug = (catObj.slugified_name || '').toLowerCase();
        
        if (slug.includes('juice') || slug.includes('drink') || slug.includes('cocktail') || slug.includes('smoothie') || slug.includes('beverage') ||
            name.includes('juice') || name.includes('drink') || name.includes('cocktail') || name.includes('smoothie') || name.includes('beverage')) {
          cat = 'juice';
        } else if (slug.includes('ice') || slug.includes('cream') || slug.includes('shake') || slug.includes('gelato') ||
                   name.includes('ice') || name.includes('cream') || name.includes('shake') || name.includes('gelato')) {
          cat = 'icecream';
        } else if (slug.includes('cake') || slug.includes('lava') || slug.includes('muffin') || slug.includes('bakery') ||
                   name.includes('cake') || name.includes('lava') || name.includes('muffin') || name.includes('bakery')) {
          cat = 'cake';
        } else if (slug.includes('crepe') || slug.includes('chocolate') || slug.includes('waffle') || slug.includes('sweet') ||
                   name.includes('crepe') || name.includes('chocolate') || name.includes('waffle') || name.includes('sweet')) {
          cat = 'chocolate';
        } else {
          cat = slug || 'chocolate';
        }
      }
    }

    let desc = p.description || '';
    if (desc && desc.includes('<')) {
      desc = desc.replace(/<[^>]*>/g, '').trim();
    }

    const finalPrice = Number(isNaN(price) ? 0 : price);

    let stockQty = 99;
    if (p.stock_quantity !== undefined && p.stock_quantity !== null) {
      stockQty = Number(p.stock_quantity);
    } else if (p.remaining_stock !== undefined && p.remaining_stock !== null) {
      stockQty = Number(p.remaining_stock);
    } else if (p.quantity !== undefined && p.quantity !== null) {
      stockQty = Number(p.quantity);
    }

    return {
      id: p.id || p.uid,
      name: p.name || p.title,
      description: desc,
      price: finalPrice,
      priceLabel: `$${finalPrice.toFixed(2)}`,
      image: img,
      category: cat,
      is_popular: !!(p.is_popular || p.featured),
      isPopular: !!(p.is_popular || p.featured),
      badge: sanitizeOsimartBadge(p.badge || (p.featured ? 'Popular' : ''), stockQty),
      quantity: stockQty,
      variants: p.variants || p.variant_types || p.product_variants || []
    };
  } catch (error) {
    console.warn(`Error fetching Osimart single product detail for ${id}:`, error);
    return null;
  }
}

/**
 * Fetches active promotion codes from Osimart API
 */
export async function fetchStorePromoCodes(url: string = OSIMART_PROMO_CODES_API_URL): Promise<OsimartPromoCode[]> {
  try {
    const response = await fetch(getProxyUrl(url), {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    
    let list: any[] = [];
    if (Array.isArray(data)) {
      list = data;
    } else if (data && Array.isArray(data.results)) {
      list = data.results;
    } else if (data && Array.isArray(data.data)) {
      list = data.data;
    }

    return list.map(promo => ({
      code: promo.code || '',
      discount_percentage: Number(promo.discount_percentage || promo.discount || 0),
      active: promo.active !== false,
      minimum_order_amount: Number(promo.minimum_order_amount || promo.min_order || 0)
    }));
  } catch (error) {
    console.warn('Error fetching Osimart store promo codes:', error);
    return [];
  }
}

/**
 * Updates an item in the Osimart cart on the server side
 */
export async function updateOsimartCartItem(
  productId: string | number,
  quantity: number,
  extras?: string[],
  notes?: string,
  productName?: string
): Promise<any> {
  try {
    let sessionId = localStorage.getItem('osimart_session_id');
    if (!sessionId) {
      sessionId = 'sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('osimart_session_id', sessionId);
    }

    const osimartCookie = localStorage.getItem('osimart_cookie') || '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (osimartCookie) {
      headers['X-Osimart-Cookie'] = osimartCookie;
    }

    const response = await fetch('/api/osimart/cart/update-item', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        product_id: productId,
        product_name: productName || '',
        quantity: quantity,
        extras: extras || [],
        notes: notes || '',
        session_id: sessionId,
        cart_id: sessionId,
        store: OSIMART_STORE_ID
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.details || errData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data && data.osimart_cookie) {
      localStorage.setItem('osimart_cookie', data.osimart_cookie);
    }
    return data;
  } catch (error: any) {
    console.warn('Osimart Cart Update API failed:', error.message);
    throw error;
  }
}

/**
 * Views the current Osimart cart on the server side
 */
export async function fetchOsimartCart(): Promise<any> {
  try {
    let sessionId = localStorage.getItem('osimart_session_id');
    if (!sessionId) {
      sessionId = 'sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('osimart_session_id', sessionId);
    }

    const osimartCookie = localStorage.getItem('osimart_cookie') || '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (osimartCookie) {
      headers['X-Osimart-Cookie'] = osimartCookie;
    }

    const response = await fetch('/api/osimart/cart/view', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        session_id: sessionId,
        cart_id: sessionId,
        store: OSIMART_STORE_ID
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || errData.details || `HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data && data.osimart_cookie) {
      localStorage.setItem('osimart_cookie', data.osimart_cookie);
    }
    return data;
  } catch (error: any) {
    console.warn('Osimart Cart View API failed:', error.message);
    throw error;
  }
}

/**
 * Log in to Osimart as a customer
 */
export async function loginOsimartCustomer(email: string, password: string, deviceName: string, deviceId: string): Promise<any> {
  try {
    const response = await fetch('/api/osimart/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        email,
        password,
        device_name: deviceName,
        device_id: deviceId
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.details || errData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data && data.osimart_cookie) {
      localStorage.setItem('osimart_cookie', data.osimart_cookie);
    }
    return data;
  } catch (error: any) {
    console.warn('Osimart Customer Login API failed:', error.message);
    throw error;
  }
}

/**
 * Register or add a customer to Osimart (guests or registered accounts)
 */
export async function createOsimartCustomer(
  name: string,
  email: string,
  phone: string,
  city: string,
  is_guest: boolean = true,
  status?: string
): Promise<any> {
  try {
    const response = await fetch('/api/osimart/customers/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        name,
        email,
        phone,
        city,
        is_guest,
        status
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.details || errData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    console.warn('Osimart Customer Create API failed:', error.message);
    throw error;
  }
}

/**
 * Verify customer OTP code on Osimart
 */
export async function verifyOsimartOtp(email: string, code: string): Promise<any> {
  try {
    const response = await fetch('/api/osimart/auth/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        email,
        code,
        store_id: OSIMART_STORE_ID
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.details || errData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    console.warn('Osimart OTP Verification failed:', error.message);
    throw error;
  }
}

/**
 * Regenerate / Resend OTP code to customer email on Osimart
 */
export async function regenOsimartOtp(email: string): Promise<any> {
  try {
    const response = await fetch('/api/osimart/auth/regen', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        email,
        store_id: OSIMART_STORE_ID
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.details || errData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    console.warn('Osimart OTP Regeneration failed:', error.message);
    throw error;
  }
}

/**
 * Change customer password on Osimart
 */
export async function changeOsimartPassword(oldPassword: string, newPassword: string): Promise<any> {
  try {
    const osimartCookie = localStorage.getItem('osimart_cookie') || '';
    const loggedUserStr = localStorage.getItem('loggedUser');
    let token = '';
    if (loggedUserStr) {
      try {
        const parsed = JSON.parse(loggedUserStr);
        token = parsed.token || '';
      } catch (_) {}
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (osimartCookie) {
      headers['X-Osimart-Cookie'] = osimartCookie;
    }

    const response = await fetch('/api/osimart/auth/change_password', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        old_password: oldPassword,
        new_password: newPassword
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.details || errData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    console.warn('Osimart Change Password failed:', error.message);
    throw error;
  }
}

/**
 * Send request for password reset email / OTP on Osimart
 */
export async function forgetOsimartPassword(email: string): Promise<any> {
  try {
    const response = await fetch('/api/osimart/auth/forget_password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        email,
        reset_as: 'customer',
        store_id: OSIMART_STORE_ID
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.details || errData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    console.warn('Osimart Forget Password failed:', error.message);
    throw error;
  }
}

/**
 * Confirm password reset using OTP code on Osimart
 */
export async function resetOsimartPassword(email: string, code: string, password: string): Promise<any> {
  try {
    const response = await fetch('/api/osimart/auth/reset_password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        email,
        code,
        password,
        reset_as: 'customer',
        store_id: OSIMART_STORE_ID
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.details || errData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    console.warn('Osimart Reset Password failed:', error.message);
    throw error;
  }
}

/**
 * Refresh customer access token on Osimart
 */
export async function refreshOsimartToken(refreshToken: string): Promise<any> {
  try {
    const response = await fetch('/api/osimart/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        refresh: refreshToken
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.details || errData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    console.warn('Osimart Token Refresh failed:', error.message);
    throw error;
  }
}



