const WOO_BASE   = 'https://spacepadel.es/wp-json/wc/v3';
const WOO_KEY    = 'ck_c933a889fac318efe36737dbb1b249cd27df1623';
const WOO_SECRET = 'cs_f996b1e42938e6fa2fee5a2ad2665fd4d6074948';
const WOO_AUTH   = 'Basic ' + Buffer.from(`${WOO_KEY}:${WOO_SECRET}`).toString('base64');

const SHOPIFY_STORE = 'palaspersonalizadas.myshopify.com';
const SHOPIFY_TOKEN = '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';
const WOO_MIN_ORDER = 1820;

// Limpia el teléfono para que Shopify lo acepte.
// Si está vacío o no tiene dígitos suficientes, devuelve cadena vacía (Shopify acepta sin teléfono).
function cleanPhone(phone) {
  if (!phone) return '';
  // Quitar todo excepto dígitos y el + inicial
  let cleaned = phone.replace(/[^\d+]/g, '');
  // Si ya empieza con + lo dejamos
  if (cleaned.startsWith('+')) return cleaned;
  // Si empieza con 00, convertir a +
  if (cleaned.startsWith('00')) return '+' + cleaned.slice(2);
  // Si es un número español de 9 dígitos, añadir +34
  if (/^\d{9}$/.test(cleaned)) return '+34' + cleaned;
  // Si tiene más dígitos pero sin prefijo, añadir +34
  if (cleaned.length >= 9) return '+34' + cleaned;
  // Si no podemos arreglarlo, devolvemos vacío para evitar el error
  return '';
}

async function getWooOrders(limit = 50) {
  const url = `${WOO_BASE}/orders?per_page=${limit}&orderby=date&order=desc&status=processing`;
  const res = await fetch(url, { headers: { 'Authorization': WOO_AUTH } });
  if (!res.ok) throw new Error(`WooCommerce error: ${res.status}`);
  const orders = await res.json();
  return orders.filter(o => parseInt(o.number) >= WOO_MIN_ORDER);
}

async function shopifyOrderExists(wooNumber) {
  const url = `https://${SHOPIFY_STORE}/admin/api/2026-04/orders.json?tag=woo-${wooNumber}&status=any`;
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN }
  });
  if (!res.ok) throw new Error(`Shopify error comprobando duplicado: ${res.status}`);
  const data = await res.json();
  return data.orders && data.orders.length > 0 ? data.orders[0] : null;
}

async function createShopifyOrder(wooOrder) {
  const phone = cleanPhone(wooOrder.billing?.phone);

  const body = {
    order: {
      email: wooOrder.billing?.email || '',
      phone: phone,
      note: `Pedido importado desde WooCommerce #${wooOrder.number} · spacepadel.es`,
      tags: `woo-${wooOrder.number}, woocommerce, spacepadel.es`,
      financial_status: 'paid',
      line_items: (wooOrder.line_items || []).map(i => ({
        title: i.name,
        quantity: i.quantity,
        price: parseFloat(i.price) > 0 ? parseFloat(i.price).toFixed(2) : parseFloat(wooOrder.total || 0).toFixed(2)
      })),
      shipping_address: {
        first_name: wooOrder.shipping?.first_name || wooOrder.billing?.first_name || '',
        last_name:  wooOrder.shipping?.last_name  || wooOrder.billing?.last_name  || '',
        address1:   wooOrder.shipping?.address_1  || wooOrder.billing?.address_1  || '',
        city:       wooOrder.shipping?.city       || wooOrder.billing?.city       || '',
        zip:        wooOrder.shipping?.postcode   || wooOrder.billing?.postcode   || '',
        country:    wooOrder.shipping?.country    || wooOrder.billing?.country    || 'ES',
        phone:      phone,
      },
      billing_address: {
        first_name: wooOrder.billing?.first_name || '',
        last_name:  wooOrder.billing?.last_name  || '',
        address1:   wooOrder.billing?.address_1  || '',
        city:       wooOrder.billing?.city       || '',
        zip:        wooOrder.billing?.postcode   || '',
        country:    wooOrder.billing?.country    || 'ES',
        phone:      phone,
      }
    }
  };

  const res = await fetch(`https://${SHOPIFY_STORE}/admin/api/2026-04/orders.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_TOKEN
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(JSON.stringify(err));
  }
  const data = await res.json();
  return data.order;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const orders = await getWooOrders(50);
      return res.status(200).json({ ok: true, count: orders.length, orders });
    }

    if (req.method === 'POST') {
      const orders = await getWooOrders(50);
      const results = [];

      for (const order of orders) {
        const existing = await shopifyOrderExists(order.number);
        if (existing) {
          results.push({ wooNumber: order.number, ok: true, skipped: true, reason: `Ya existe en Shopify #${existing.order_number}` });
          continue;
        }
        try {
          const shopifyOrder = await createShopifyOrder(order);
          results.push({ wooNumber: order.number, ok: true, skipped: false, shopifyId: shopifyOrder?.id, shopifyNumber: shopifyOrder?.order_number });
        } catch (e) {
          results.push({ wooNumber: order.number, ok: false, skipped: false, error: e.message });
        }
      }

      const created = results.filter(r => r.ok && !r.skipped).length;
      const skipped = results.filter(r => r.skipped).length;
      const failed  = results.filter(r => !r.ok).length;

      console.log('WooCommerce sync:', JSON.stringify({ created, skipped, failed, results }));
      return res.status(200).json({ ok: true, created, skipped, failed, results });
    }

    return res.status(405).json({ ok: false, error: 'Método no permitido' });

  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
