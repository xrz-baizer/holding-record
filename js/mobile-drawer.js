(() => {
  const phone = window.matchMedia('(max-width:760px), (max-width:950px) and (pointer:coarse)');
  const bar = document.querySelector('#phone-bar');
  const drawer = document.querySelector('#mobile-drawer');
  const toggle = document.querySelector('#drawer-toggle');
  const close = document.querySelector('#drawer-close');
  const sidebar = document.querySelector('.summary-sidebar');
  const stocks = document.querySelector('#stocks');
  const pageCount = document.querySelector('#phone-page-count');
  const stockName = document.querySelector('#phone-stock-name');
  const stockCode = document.querySelector('#phone-stock-code');
  const stockTools = document.querySelector('#mobile-stock-tools');
  const heading = document.querySelector('#sidebar-title');
  const editStock = stockTools.querySelector('[data-action="edit-stock"]');
  const history = stockTools.querySelector('[data-action="history"]');
  const modal = document.querySelector('#modal');
  const viewport = window.visualViewport;
  let frame;

  function sizeLotDialog() {
    if (!phone.matches || !viewport) return;
    modal.style.setProperty('--lot-view-height', viewport.height + 'px');
    modal.style.setProperty('--lot-view-top', viewport.offsetTop + 'px');
    modal.toggleAttribute('data-short-view', viewport.height < 280);
  }

  function reflectOpen() {
    toggle.setAttribute('aria-expanded', String(drawer.open));
    document.documentElement.classList.toggle('drawer-open', drawer.open);
  }

  function trackStock() {
    frame = 0;
    if (!phone.matches) return;
    const index = phonePageIndex(stocks);
    const current = stocks.children[index];
    const stockId = current?.dataset.stockId,code = current?.dataset.stockCode;
    const name = current?.querySelector('h2')?.textContent || I18n.t('我的持仓');
    if (stockName.textContent !== name) stockName.textContent = name;
    stockCode.hidden = !code;
    stockCode.textContent = code || '';
    stockTools.hidden = !stockId;
    for (const trigger of [editStock,history]) trigger.dataset.id = stockId || '';
    editStock.textContent = I18n.t('修改股票');
    history.textContent = I18n.t('交易历史');
    toggle.setAttribute('aria-label', I18n.t('菜单'));
    const count = stocks.children.length;
    pageCount.hidden = count < 2;
    const position = count > 1 ? (index + 1) + ' / ' + count : '';
    if (pageCount.textContent !== position) pageCount.textContent = position;
  }

  function scheduleTrack() {
    if (phone.matches && !frame) frame = requestAnimationFrame(trackStock);
  }

  function setLayout() {
    sizeLotDialog();
    if (drawer.open) drawer.close();
    stocks.classList.toggle('stock-pages', phone.matches);
    const changed = bar.hidden === phone.matches;
    if (phone.matches) drawer.append(sidebar);
    else stocks.before(sidebar);
    bar.hidden = !phone.matches;
    close.hidden = !phone.matches;
    heading.toggleAttribute('autofocus',phone.matches);
    if (!phone.matches) stockTools.hidden = true;
    if (changed) {
      const drafts = new Map([...stocks.querySelectorAll('.quote-badge input[data-dirty]')].map(input=>[input.form.dataset.stock,input.value]));
      render();
      for (const input of stocks.querySelectorAll('.quote-badge input')) {
        if (!drafts.has(input.form.dataset.stock)) continue;
        input.value = drafts.get(input.form.dataset.stock);
        input.dispatchEvent(new Event('input',{bubbles:true}));
      }
    }
    scheduleTrack();
  }

  toggle.addEventListener('click', () => {
    close.setAttribute('aria-label', I18n.t('关闭'));
    trackStock();
    drawer.scrollTop = 0;
    drawer.showModal();
    reflectOpen();
    heading.focus({preventScroll:true});
  });
  drawer.addEventListener('close', reflectOpen);
  drawer.addEventListener('click', event => {
    if (event.target.closest('#drawer-close, [data-action]')) drawer.close();
    else if (event.target === drawer) {
      const rect = drawer.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) drawer.close();
    }
  });
  new MutationObserver(scheduleTrack).observe(stocks, {childList:true});
  stocks.addEventListener('scroll', scheduleTrack, {passive:true});
  window.addEventListener('resize', scheduleTrack);
  viewport?.addEventListener('resize', sizeLotDialog);
  viewport?.addEventListener('scroll', sizeLotDialog, {passive:true});
  phone.addEventListener('change', setLayout);
  setLayout();
})();
