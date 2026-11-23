require('dotenv').config();
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const APISH = 'https://api.api.sh';
async function apiSh(pathname, params = {}) {
  if (!process.env.APISH_KEY) throw new Error('APISH_KEY ontbreekt op de server.');
  const url = new URL(APISH + pathname);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  const r = await fetch(url, {
    headers: { 'x-api-key': process.env.APISH_KEY },
    signal: AbortSignal.timeout(60000)
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!r.ok) throw new Error(`API.SH ${r.status}: ${data.error || text}`);
  return data;
}

app.get('/api/health', (req, res) => res.json({ ok: true, apiKeyConfigured: !!process.env.APISH_KEY }));

// Uses API.SH's current Skyscanner hotel endpoint because it accepts exact dates
// and returns live-ish per-night/total prices plus booking-site offers in one call.
app.get('/api/accommodations', async (req, res) => {
  try {
    const p = req.query;
    if (!p.destination) return res.status(400).json({ error: 'destination is required' });
    if (!p.checkin || !p.checkout) return res.status(400).json({ error: 'checkin and checkout are required' });
    const data = await apiSh('/skyscanner/v1/hotels', {
      q: p.destination,
      checkin: p.checkin,
      checkout: p.checkout,
      adults: p.adults || 2,
      rooms: p.rooms || 1,
      sort: p.sort || 'best',
      price_type: 'night',
      market: 'NL',
      currency: 'EUR',
      limit: 24,
      offset: 0
    });
    const hotels = (data.hotels || []).map(h => ({
      id: h.id,
      name: h.name,
      address: h.area || '',
      city: h.area || p.destination,
      rating: h.rating || 0,
      ratingLabel: h.rating_label || '',
      reviews: h.reviews || 0,
      stars: h.stars || 0,
      image: (h.images && h.images[0]) || h.image || '',
      images: h.images || [],
      url: h.url || '',
      lat: h.latitude || null,
      lng: h.longitude || null,
      pricePerNight: h.price_with_taxes || h.price || null,
      totalPrice: h.total_price || null,
      priceType: h.price_type || 'per_night',
      priceBeforeDiscount: h.price_before_discount || null,
      discountPercent: h.discount_percent || null,
      currency: h.currency || 'EUR',
      offers: h.offers || [],
      area: h.area || '',
      distance: h.distance || null,
      propertyType: h.property_type || ''
    }));
    res.json({
      hotels,
      total: data.total || data.count || hotels.length,
      nextOffset: data.next_offset ?? null,
      creditsUsed: data.credits_used || 0,
      checkin: data.checkin,
      checkout: data.checkout,
      nights: Math.max(1, Math.round((new Date(data.checkout) - new Date(data.checkin)) / 86400000))
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Optional exact Booking.com room lookup for a selected hotel link.
app.get('/api/rooms', async (req, res) => {
  try {
    const { url, checkin, checkout, adults = 2, rooms = 1 } = req.query;
    if (!url || !checkin || !checkout) return res.status(400).json({ error: 'url, checkin and checkout are required' });
    const data = await apiSh('/booking/v1/hotel-rooms', { url, checkin, checkout, adults, rooms, currency: 'EUR' });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Simple OSRM routing for the selected bases.
app.get('/api/route', async (req, res) => {
  try {
    const coords = String(req.query.coords || '').split(';').filter(Boolean);
    if (coords.length < 2) return res.json({ distanceKm: 0, durationMin: 0, geometry: null, legs: [] });
    const url = `https://router.project-osrm.org/route/v1/driving/${coords.join(';')}?overview=full&geometries=geojson&steps=false`;
    const r = await fetch(url, { headers: { 'User-Agent': 'HoneymoonAtlas/1.0 personal trip planner' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`Route service ${r.status}`);
    const d = await r.json();
    const route = d.routes?.[0];
    if (!route) throw new Error('Geen route gevonden');
    res.json({
      distanceKm: route.distance / 1000,
      durationMin: route.duration / 60,
      geometry: route.geometry,
      legs: (route.legs || []).map(l => ({ distanceKm: l.distance / 1000, durationMin: l.duration / 60 }))
    });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Honeymoon Atlas running on ${PORT}`));
