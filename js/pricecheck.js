// pricecheck.js — Pokemon card price lookup via pokemontcg.io API

const PriceCheck = {
  open(productName, sku) {
    const enc = encodeURIComponent(productName || '');
    const safe = (productName || '').replace(/"/g, '&quot;');

    const body = `
      <div style="display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;gap:8px">
          <input type="text" id="pc-query" class="search-input" style="flex:1"
            value="${safe}" placeholder="e.g. Charizard ex, Pikachu VMAX…" autocomplete="off">
          <button class="btn-primary" id="pc-search" style="white-space:nowrap">Search</button>
        </div>

        <div id="pc-results"></div>

        <div style="border-top:1px solid var(--border);padding-top:12px">
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
            Sealed product &amp; market prices:
          </p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a href="https://www.ebay.com/sch/i.html?_nkw=${enc}&LH_Sold=1&LH_Complete=1"
               target="_blank" class="btn-secondary" style="font-size:12px">eBay Sold ↗</a>
            <a href="https://www.tcgplayer.com/search/pokemon/product?q=${enc}&productLineName=pokemon"
               target="_blank" class="btn-secondary" style="font-size:12px">TCGPlayer ↗</a>
            <a href="https://www.pricecharting.com/search-products?q=${enc}&type=prices"
               target="_blank" class="btn-secondary" style="font-size:12px">PriceCharting ↗</a>
          </div>
        </div>
      </div>`;

    Modal.open(`🔍 Price Lookup — ${productName}`, body, () => true);

    document.getElementById('pc-search')?.addEventListener('click', () => this._search());
    document.getElementById('pc-query')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') this._search();
    });

    // Auto-search on open
    this._search();
  },

  async _search() {
    const q   = document.getElementById('pc-query')?.value.trim();
    const el  = document.getElementById('pc-results');
    if (!q || !el) return;

    el.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Searching…</p>';

    try {
      // name: must be a literal colon in the URL — only encode the search value itself
      const url = `https://api.pokemontcg.io/v2/cards?q=name:"${encodeURIComponent(q)}"&pageSize=8&select=id,name,set,rarity,tcgplayer,images`;
      const res  = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      if (!json.data?.length) {
        el.innerHTML = `
          <div style="padding:12px 14px;background:var(--surface2);border-radius:6px;font-size:13px;color:var(--text-muted)">
            No individual cards matched "<strong style="color:var(--text)">${q}</strong>".
            For sealed products (ETBs, booster boxes) use the links below.
          </div>`;
        return;
      }

      el.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:6px;max-height:320px;overflow-y:auto;padding-right:2px">
          ${json.data.map(card => this._cardRow(card)).join('')}
        </div>`;

    } catch (e) {
      el.innerHTML = `<p style="color:var(--red);font-size:13px">Error: ${e.message} — check your connection.</p>`;
    }
  },

  _cardRow(card) {
    const prices     = card.tcgplayer?.prices || {};
    const priceTypes = Object.keys(prices);

    const LABELS = { normal: 'Normal', holofoil: 'Holo', reverseHolofoil: 'Rev. Holo', firstEditionHolofoil: '1st Holo' };

    const priceStr = priceTypes.length
      ? priceTypes.map(t => {
          const p   = prices[t];
          const val = p.market ?? p.mid ?? 0;
          const lbl = LABELS[t] || t;
          return `<span style="font-size:11px;white-space:nowrap">
            <span style="color:var(--text-muted)">${lbl}:</span>
            <strong style="color:var(--green)">$${val.toFixed(2)}</strong>
          </span>`;
        }).join('<span style="color:var(--border);margin:0 3px">·</span>')
      : `<span style="color:var(--text-muted);font-size:12px">No price data</span>`;

    const img = card.images?.small
      ? `<img src="${card.images.small}" alt="" loading="lazy"
           style="height:68px;width:auto;border-radius:4px;flex-shrink:0;object-fit:contain;background:var(--surface)">`
      : `<div style="width:48px;height:68px;background:var(--surface);border-radius:4px;flex-shrink:0"></div>`;

    const tcgLink = card.tcgplayer?.url
      ? `<a href="${card.tcgplayer.url}" target="_blank"
           style="font-size:11px;color:var(--accent);white-space:nowrap;flex-shrink:0;padding-top:2px">TCG ↗</a>`
      : '';

    return `
      <div style="display:flex;align-items:flex-start;gap:10px;background:var(--surface2);border-radius:6px;padding:10px 12px">
        ${img}
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${card.name}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:5px">${card.set?.name || ''} · ${card.rarity || ''}</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">${priceStr}</div>
        </div>
        ${tcgLink}
      </div>`;
  },
};
