// Achat d'un produit numérique : paiement FlexPay (Mobile Money ou carte), puis page de reçu avec téléchargement
(function () {
  var f = document.getElementById('mireb-commande'); if (!f || f.tagName !== 'FORM') return;
  var phone = f.querySelector('[name=phone]'), err = f.querySelector('.derr'), btn = f.querySelector('button');
  function sync() { var mobile = f.method.value === 'mobile'; phone.required = mobile; phone.placeholder = mobile ? 'Numéro Mobile Money (ex : 0812345678)' : 'Téléphone (facultatif)'; }
  f.addEventListener('change', sync); sync();
  f.addEventListener('submit', function (e) {
    e.preventDefault(); err.textContent = ''; btn.disabled = true; var label = btn.textContent; btn.textContent = 'Connexion à FlexPay…';
    var d = Object.fromEntries(new FormData(f)); d.product_id = f.getAttribute('data-product'); d.canal = f.getAttribute('data-canal');
    fetch('/public/digital/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) })
      .then(function (r) { return r.json(); }).then(function (r) {
        if (!r.ok) throw new Error(r.error || 'Erreur');
        if (window.fbq) fbq('track', 'InitiateCheckout', { content_ids: [d.product_id], content_type: 'product' });
        location.href = r.redirect || r.receipt;   // carte : page FlexPay ; Mobile Money : page d'attente de validation
      }).catch(function (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = label; });
  });
})();
