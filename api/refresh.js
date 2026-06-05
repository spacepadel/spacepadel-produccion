const SHOPIFY_TOKEN = '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';
const SHOPIFY_STORE = 'palaspersonalizadas.myshopify.com';
const SUPABASE_URL  = 'https://deafcxizysvbnbgailno.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_G1-WfUDe-Yq8aFxghbWYSA_Xxu7awui';
const KEY_ORDERS    = 'sp-orders-v1';

async function getOrders() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const url = `https://${SHOPIFY_STORE}/admin/api/2026-04/orders.json?status=open&created_at_min=${cutoff}&limit=100&fields=id,name,created_at,cancel_reason,cancelled_at,financial_status,fulfillment_status,note,customer,line_items`;
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN }
  });
  const data = await res.json();
  return (data.orders || [])
    .filter(o => !o.cancelled_at && o.fulfillment_status !== 'fulfilled')
    .map(o => ({
      id: `gid://shopify/Order/${o.id}`,
      name: o.name,
      createdAt: o.created_at,
      customerName: o.customer ? `${o.customer.first_name} ${o.customer.last_name}`.trim() : 'Cliente (invitado)',
      financialStatus: o.financial_status.toUpperCase(),
      fulfillmentStatus: (o.fulfillment_status || 'unfulfilled').toUpperCase(),
      cancelledAt: o.cancelled_at || null,
      note: o.note || null,
      lineItems: o.line_items.map(l => ({ title: l.title, quantity: l.quantity }))
    }));
}

async function saveToSupabase(orders) {
  const body = JSON.stringify({ key: KEY_ORDERS, value: JSON.stringify({ orders, modified: Date.now() }) });
  await fetch(`${SUPABASE_URL}/rest/v1/kv`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    },
    body
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const orders = await getOrders();
    await saveToSupabase(orders);
    res.status(200).json({ ok: true, count: orders.length, orders });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
